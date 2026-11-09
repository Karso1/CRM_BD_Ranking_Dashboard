'use client';
import { ThemeProvider, useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';

export function AppThemeProvider({children}:{children:React.ReactNode}) {
 return <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem storageKey={`upay-appearance-${process.env.NEXT_PUBLIC_DEPLOYMENT_ENV === "staging" ? "staging" : "production"}`} disableTransitionOnChange>{children}</ThemeProvider>;
}
export function ThemeToggle({lang}:{lang:'en'|'zh'}) {
 const {theme,setTheme}=useTheme();
 const mode=theme??'system';
 const Icon=mode==='light'?Sun:mode==='dark'?Moon:Monitor;
 const zh=lang==='zh';
 return <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="icon-button theme-trigger" aria-label={zh?'外观模式':'Appearance'} title={zh?'选择白天、黑夜或跟随设备':'Choose light, dark or system appearance'}><Icon size={17}/><span>{zh?'外观':'Theme'}</span></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="export-menu theme-menu"><DropdownMenuRadioGroup value={mode} onValueChange={setTheme}><DropdownMenuRadioItem value="system"><Monitor size={15}/>{zh?'跟随设备':'Use device setting'}</DropdownMenuRadioItem><DropdownMenuRadioItem value="light"><Sun size={15}/>{zh?'白天模式':'Light mode'}</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark"><Moon size={15}/>{zh?'黑夜模式':'Dark mode'}</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>;
}
