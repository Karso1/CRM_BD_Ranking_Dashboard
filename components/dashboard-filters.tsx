"use client";

import { format } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function FilterSelect({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="dashboard-select" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="dashboard-select-menu" position="popper" align="start">
        {options.map((option) => (
          <SelectItem className="dashboard-select-option" key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DashboardDatePicker({
  value,
  min,
  max,
  onChange,
  lang,
}: {
  value: string;
  min: string;
  max: string;
  onChange: (value: string) => void;
  lang: "zh" | "en";
}) {
  const date = new Date(`${value}T12:00:00`);
  const minDate = new Date(`${min}T00:00:00`);
  const maxDate = new Date(`${max}T23:59:59`);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="dashboard-date-trigger" aria-label={lang === "zh" ? "选择日期" : "Choose date"}>
          <CalendarDays size={15} aria-hidden="true" />
          <span>{format(date, lang === "zh" ? "yyyy/MM/dd" : "dd MMM yyyy", { locale: lang === "zh" ? zhCN : enUS })}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="dashboard-calendar-popover" align="start" sideOffset={8}>
        <Calendar
          mode="single"
          selected={date}
          onSelect={(next) => next && onChange(format(next, "yyyy-MM-dd"))}
          disabled={{ before: minDate, after: maxDate }}
          locale={lang === "zh" ? zhCN : enUS}
          defaultMonth={date}
          showOutsideDays={false}
          className="dashboard-calendar"
        />
      </PopoverContent>
    </Popover>
  );
}
