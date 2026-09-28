from datetime import datetime
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/daily-operations/90-系统维护'))
from agent_profiles import cooperation_date, read_profiles

class AgentProfilesTests(unittest.TestCase):
    def test_duplicate_same_email_keeps_earliest_start(self):
        sheet=MagicMock(title='Relations')
        sheet.iter_rows.return_value=iter([['BD','Categories','client','邮箱','合作开始日期','BD'],
            ['Mike','Agent','Ahmad','same@example.test','25/03/2026 05:28','Mike'],
            ['Mike','Agent','Ahmad','same@example.test','25/03/2026 05:09','Mike']])
        with patch('agent_profiles.openpyxl.load_workbook',return_value=MagicMock(worksheets=[sheet])):
            result=read_profiles(Path('test.xlsx'),'upb')
            self.assertEqual(len(result),1)
            self.assertEqual(result[0]['cooperationStart'],'2026-03-25 05:09')

    def test_upb_owner_uses_the_official_bd_list_and_maps_other_values_to_upay(self):
        sheet=MagicMock(title='Relations')
        sheet.iter_rows.return_value=iter([
            ['BD','Categories','client','邮箱','合作开始日期','BD'],
            ['luke','Agent','AllLeo','','','Mike'],
            ['mIKE','Agent','Known agent','','','Victor'],
        ])
        with patch('agent_profiles.openpyxl.load_workbook',return_value=MagicMock(worksheets=[sheet])):
            result=read_profiles(Path('test.xlsx'),'upb')
        owners={profile['name']:profile['owner'] for profile in result}
        self.assertEqual(owners,{'AllLeo':'UPay','Known agent':'Mike'})

    def test_upb_requires_the_official_bd_list(self):
        sheet=MagicMock(title='Relations')
        sheet.iter_rows.return_value=iter([['BD','Categories','client'], ['Luke','Agent','AllLeo']])
        with patch('agent_profiles.openpyxl.load_workbook',return_value=MagicMock(worksheets=[sheet])):
            with self.assertRaisesRegex(ValueError,'公开 BD 名单列'):
                read_profiles(Path('test.xlsx'),'upb')

    def test_dates_do_not_swap_day_month_or_shift_timezone(self):
        self.assertEqual(cooperation_date('02/12/2024 06:45:00'), '2024-12-02 06:45')
        self.assertEqual(cooperation_date(datetime(2024, 12, 2, 6, 45)), '2024-12-02 06:45')
        self.assertEqual(cooperation_date(None), '')
        with self.assertRaises(ValueError):
            cooperation_date('not a date')

    def test_optional_fields_and_duplicate_conflicts(self):
        for extra, expected in [([], ('','')), (['a@example.test', '02/12/2024 06:45'], ('a@example.test','2024-12-02 06:45'))]:
            sheet=MagicMock(title='Relations')
            optional_fields=(extra+['',''])[:2]
            sheet.iter_rows.return_value=iter([['BD','Categories','client','邮箱','合作开始日期','BD'], ['BD','Agent','Demo',*optional_fields,'BD']])
            book=MagicMock(worksheets=[sheet])
            with patch('agent_profiles.openpyxl.load_workbook',return_value=book):
                result=read_profiles(Path('test.xlsx'),'upb')[0]
                self.assertEqual((result['email'],result['cooperationStart']),expected)
        sheet.iter_rows.return_value=iter([['BD','Categories','client','邮箱','BD'], ['BD','Agent','Demo','one','BD'], ['BD','Agent','Demo','two','BD']])
        with patch('agent_profiles.openpyxl.load_workbook',return_value=book), self.assertRaisesRegex(ValueError,'冲突'):
            read_profiles(Path('test.xlsx'),'upb')
