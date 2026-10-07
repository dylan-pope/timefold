"use client";

import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  GripVertical,
  ListPlus,
  Moon,
  PanelLeftClose,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Sunset,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  PointerEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type DayHours = { enabled: boolean; start: number; end: number };
type Zone = {
  id: string;
  city: string;
  label: string;
  initials: string;
  timeZone: string;
  color: string;
  schedule: DayHours[];
};
type Meeting = { id: string; date: string; start: number; duration: number };
type Segment = { start: number; end: number; dayIndex?: number };
type DayPlan = {
  timelineStart: Date;
  work: Record<string, Segment[]>;
  overlap: Segment[];
};
type DragState =
  | { kind: "meeting"; meetingId: string }
  | { kind: "duration"; meetingId: string }
  | { kind: "work"; zoneId: string; edge: "start" | "end"; dayIndex: number }
  | null;

const SLOT = 15;
const MIN_MEETING = 1;
const MAX_DAY_MINUTES = 1440;
const SLOTS_PER_DAY = 1440 / SLOT;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEETING_COLORS = ["#6569db", "#d2675c", "#258b70", "#a35cc8", "#c27a35"];
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_INDEX_BY_NAME: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();
const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function weekSchedule(start: number, end: number): DayHours[] {
  return WEEKDAYS.map((_, index) => ({
    enabled: index < 5,
    start,
    end,
  }));
}

const DEFAULT_ZONES: Zone[] = [
  {
    id: "mountain",
    city: "Denver",
    label: "Mountain Time",
    initials: "MT",
    timeZone: "America/Denver",
    color: "#5a6be8",
    schedule: weekSchedule(8 * 60, 17 * 60),
  },
  {
    id: "central",
    city: "Chicago",
    label: "Central Time",
    initials: "CT",
    timeZone: "America/Chicago",
    color: "#a35cc8",
    schedule: weekSchedule(9 * 60, 18 * 60),
  },
  {
    id: "eastern",
    city: "New York",
    label: "Eastern Time",
    initials: "ET",
    timeZone: "America/New_York",
    color: "#dd685f",
    schedule: weekSchedule(9 * 60, 18 * 60),
  },
  {
    id: "india",
    city: "Bengaluru",
    label: "India Standard Time",
    initials: "IST",
    timeZone: "Asia/Kolkata",
    color: "#1d9b76",
    schedule: weekSchedule(11 * 60, 20 * 60),
  },
];

function dateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromString(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function addDays(value: string, amount: number) {
  const date = dateFromString(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekdayIndex(value: string) {
  return (dateFromString(value).getUTCDay() + 6) % 7;
}

function weekDates(value: string) {
  const monday = addDays(value, -weekdayIndex(value));
  return WEEKDAYS.map((_, index) => addDays(monday, index));
}

function formatShortDate(value: string) {
  return shortDateFormatter.format(dateFromString(value));
}

function formatLongDate(value: string) {
  return longDateFormatter.format(dateFromString(value));
}

function formatTime(minutes: number, compact = false) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  if (compact && mins === 0) return `${displayHour}${suffix.toLowerCase()}`;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${suffix}`;
}

function timeInputValue(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60,
  ).padStart(2, "0")}`;
}

function parseTimeInput(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return Math.min(1439, Math.max(0, hours * 60 + minutes));
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes === 60) return "1 hour";
  if (minutes === 90) return "1.5 hours";
  return `${minutes / 60} hours`;
}

function partsToRecord(parts: Intl.DateTimeFormatPart[]) {
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  return values;
}

function getOffsetFormatter(timeZone: string) {
  let formatter = offsetFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    offsetFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function getZonedFormatter(timeZone: string) {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function offsetForInstant(date: Date, timeZone: string) {
  const values = partsToRecord(getOffsetFormatter(timeZone).formatToParts(date));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return Math.round((asUtc - date.getTime()) / 60000);
}

function zonedDateTimeToUtc(date: string, minutes: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 0, minutes, 0);
  let result = target;
  for (let index = 0; index < 3; index += 1) {
    result = target - offsetForInstant(new Date(result), timeZone) * 60_000;
  }
  return new Date(result);
}

function zonedParts(date: Date, timeZone: string) {
  const values = partsToRecord(getZonedFormatter(timeZone).formatToParts(date));
  return {
    minutes: Number(values.hour) * 60 + Number(values.minute),
    dayIndex: DAY_INDEX_BY_NAME[values.weekday],
    day: `${values.weekday}, ${MONTHS[Number(values.month) - 1]} ${Number(
      values.day,
    )}`,
  };
}

function isWorking(minutes: number, hours: DayHours) {
  if (!hours.enabled) return false;
  if (hours.start === hours.end) return true;
  return hours.start < hours.end
    ? minutes >= hours.start && minutes < hours.end
    : minutes >= hours.start || minutes < hours.end;
}

function segmentsFromSlots(slots: boolean[]): Segment[] {
  const segments: Segment[] = [];
  let start = -1;
  slots.forEach((active, index) => {
    if (active && start === -1) start = index;
    if (!active && start !== -1) {
      segments.push({ start: start * SLOT, end: index * SLOT });
      start = -1;
    }
  });
  if (start !== -1) segments.push({ start: start * SLOT, end: 1440 });
  return segments;
}

function buildDayPlan(date: string, referenceZone: Zone, zones: Zone[]): DayPlan {
  const timelineStart = zonedDateTimeToUtc(date, 0, referenceZone.timeZone);
  const instantAt = (minute: number) =>
    new Date(timelineStart.getTime() + minute * 60_000);
  const slotsByZone = Object.fromEntries(
    zones.map((zone) => {
      const startOffset = offsetForInstant(timelineStart, zone.timeZone);
      const endOffset = offsetForInstant(instantAt(1439), zone.timeZone);
      const startLocal = zonedParts(timelineStart, zone.timeZone);
      const slots = Array.from({ length: SLOTS_PER_DAY }, (_, slot) => {
        if (startOffset !== endOffset) {
          const local = zonedParts(instantAt(slot * SLOT), zone.timeZone);
          return isWorking(local.minutes, zone.schedule[local.dayIndex]);
        }
        const totalMinutes = startLocal.minutes + slot * SLOT;
        const localMinutes = totalMinutes % 1440;
        const localDayIndex =
          (startLocal.dayIndex + Math.floor(totalMinutes / 1440)) % 7;
        return isWorking(
          localMinutes,
          zone.schedule[localDayIndex],
        );
      });
      return [zone.id, slots];
    }),
  ) as Record<string, boolean[]>;

  const work = Object.fromEntries(
    zones.map((zone) => [
      zone.id,
      segmentsFromSlots(slotsByZone[zone.id]).map((segment) => ({
        ...segment,
        dayIndex: zonedParts(
          instantAt((segment.start + segment.end) / 2),
          zone.timeZone,
        ).dayIndex,
      })),
    ]),
  ) as Record<string, Segment[]>;

  const overlap = segmentsFromSlots(
    Array.from({ length: SLOTS_PER_DAY }, (_, slot) =>
      zones.every((zone) => slotsByZone[zone.id][slot]),
    ),
  );
  return { timelineStart, work, overlap };
}

function TimeField({
  value,
  disabled,
  label,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="typed-time">
      <span className="sr-only">{label}</span>
      <input
        type="time"
        step={900}
        value={timeInputValue(value)}
        disabled={disabled}
        onChange={(event) => {
          const parsed = parseTimeInput(event.target.value);
          if (parsed !== null) onChange(parsed);
        }}
      />
    </label>
  );
}

function getDaylightIcon(minutes: number) {
  if (minutes < 6 * 60 || minutes >= 21 * 60) return Moon;
  if (minutes < 9 * 60) return SunriseIcon;
  if (minutes >= 17 * 60) return Sunset;
  return Sun;
}

function SunriseIcon({ size = 14 }: { size?: number }) {
  return <Sunset size={size} style={{ transform: "rotate(180deg)" }} />;
}

export default function Planner() {
  const initialDate = dateInputValue();
  const [zones, setZones] = useState(DEFAULT_ZONES);
  const [referenceId, setReferenceId] = useState("mountain");
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [view, setView] = useState<"day" | "week">("week");
  const [meetings, setMeetings] = useState<Meeting[]>([
    { id: "meeting-1", date: initialDate, start: 8 * 60, duration: 30 },
  ]);
  const [selectedMeetingId, setSelectedMeetingId] = useState("meeting-1");
  const [editingHours, setEditingHours] = useState(false);
  const [editorDay, setEditorDay] = useState(weekdayIndex(initialDate));
  const [dragState, setDragState] = useState<DragState>(null);
  const [hydrated, setHydrated] = useState(false);
  const nextMeetingId = useRef(2);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("timefold-settings-v2");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.zones)) setZones(parsed.zones);
          if (Array.isArray(parsed.meetings)) {
            setMeetings(parsed.meetings);
            nextMeetingId.current =
              Math.max(
                1,
                ...parsed.meetings.map((meeting: Meeting) =>
                  Number(meeting.id.replace("meeting-", "")),
                ),
              ) + 1;
          }
          if (parsed.referenceId) setReferenceId(parsed.referenceId);
          if (parsed.view) setView(parsed.view);
        }
      } catch {
        // Local preferences are optional.
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const save = window.setTimeout(() => {
      window.localStorage.setItem(
        "timefold-settings-v2",
        JSON.stringify({ zones, meetings, referenceId, view }),
      );
    }, 300);
    return () => window.clearTimeout(save);
  }, [zones, meetings, referenceId, view, hydrated]);

  const referenceZone =
    zones.find((zone) => zone.id === referenceId) ?? zones[0];
  const deferredZones = useDeferredValue(zones);
  const deferredReferenceZone =
    deferredZones.find((zone) => zone.id === referenceId) ?? deferredZones[0];
  const selectedWeekStart = addDays(
    selectedDate,
    -weekdayIndex(selectedDate),
  );
  const dates = useMemo(
    () => weekDates(selectedWeekStart),
    [selectedWeekStart],
  );
  const weekPlans = useMemo(
    () =>
      Object.fromEntries(
        dates.map((date) => [
          date,
          buildDayPlan(date, deferredReferenceZone, deferredZones),
        ]),
      ) as Record<string, DayPlan>,
    [dates, deferredReferenceZone, deferredZones],
  );
  const dayPlan = useMemo(
    () =>
      deferredZones === zones && weekPlans[selectedDate]
        ? weekPlans[selectedDate]
        : buildDayPlan(selectedDate, referenceZone, zones),
    [
      deferredZones,
      zones,
      weekPlans,
      selectedDate,
      referenceZone,
    ],
  );
  const meetingsToday = meetings
    .filter((meeting) => meeting.date === selectedDate)
    .sort((a, b) => a.start - b.start);
  const selectedMeeting =
    meetings.find((meeting) => meeting.id === selectedMeetingId) ??
    meetingsToday[0] ??
    null;

  const instantAt = (minute: number, plan = dayPlan) =>
    new Date(plan.timelineStart.getTime() + minute * 60_000);

  const meetingDetails = selectedMeeting
    ? zones.map((zone) => {
        const start = zonedParts(instantAt(selectedMeeting.start), zone.timeZone);
        const end = zonedParts(
          instantAt(selectedMeeting.start + selectedMeeting.duration),
          zone.timeZone,
        );
        const samples = Array.from(
          {
            length: Math.max(
              1,
              Math.ceil(selectedMeeting.duration / SLOT),
            ),
          },
          (_, index) => selectedMeeting.start + index * SLOT,
        );
        const working = samples.filter((minute) => {
          const local = zonedParts(instantAt(minute), zone.timeZone);
          return isWorking(local.minutes, zone.schedule[local.dayIndex]);
        }).length;
        return {
          zone,
          start,
          end,
          status:
            working === samples.length
              ? ("within" as const)
              : working === 0
                ? ("outside" as const)
                : ("partial" as const),
        };
      })
    : [];

  const fullyWithin = meetingDetails.filter(
    (detail) => detail.status === "within",
  ).length;
  const score = meetingDetails.length
    ? Math.round((fullyWithin / zones.length) * 100)
    : 0;
  const bestWindow = selectedMeeting
    ? dayPlan.overlap.find(
        (segment) =>
          segment.end - segment.start >= selectedMeeting.duration,
      )
    : dayPlan.overlap[0];

  const chooseDate = (date: string) => {
    setSelectedDate(date);
    setEditorDay(weekdayIndex(date));
    const first = meetings
      .filter((meeting) => meeting.date === date)
      .sort((a, b) => a.start - b.start)[0];
    setSelectedMeetingId(first?.id ?? "");
  };

  const updateMeeting = (id: string, updates: Partial<Meeting>) => {
    setMeetings((current) => {
      let changed = false;
      const next = current.map((meeting) => {
        if (meeting.id !== id) return meeting;
        const updated = { ...meeting, ...updates };
        if (
          updated.date === meeting.date &&
          updated.start === meeting.start &&
          updated.duration === meeting.duration
        ) {
          return meeting;
        }
        changed = true;
        return updated;
      });
      return changed ? next : current;
    });
  };

  const addMeeting = (date = selectedDate, start?: number) => {
    const plan = weekPlans[date] ?? dayPlan;
    const suggested =
      start ??
      plan.overlap.find((segment) => segment.end - segment.start >= 30)?.start ??
      8 * 60;
    const id = `meeting-${nextMeetingId.current}`;
    nextMeetingId.current += 1;
    setMeetings((current) => [
      ...current,
      { id, date, start: suggested, duration: 30 },
    ]);
    setSelectedDate(date);
    setSelectedMeetingId(id);
  };

  const deleteMeeting = (id: string) => {
    const remaining = meetings.filter((meeting) => meeting.id !== id);
    setMeetings(remaining);
    setSelectedMeetingId(
      remaining.find((meeting) => meeting.date === selectedDate)?.id ?? "",
    );
  };

  const updateHours = (
    zoneId: string,
    dayIndex: number,
    updates: Partial<DayHours>,
  ) => {
    setZones((current) => {
      let changed = false;
      const next = current.map((zone) => {
        if (zone.id !== zoneId) return zone;
        const currentHours = zone.schedule[dayIndex];
        const nextHours = { ...currentHours, ...updates };
        if (
          nextHours.enabled === currentHours.enabled &&
          nextHours.start === currentHours.start &&
          nextHours.end === currentHours.end
        ) {
          return zone;
        }
        changed = true;
        return {
          ...zone,
          schedule: zone.schedule.map((hours, index) =>
            index === dayIndex ? nextHours : hours,
          ),
        };
      });
      return changed ? next : current;
    });
  };

  const copyEditorDayToWeekdays = () => {
    setZones((current) =>
      current.map((zone) => ({
        ...zone,
        schedule: zone.schedule.map((hours, index) =>
          index < 5 ? { ...zone.schedule[editorDay] } : hours,
        ),
      })),
    );
  };

  const minuteFromPointer = (
    event: PointerEvent<HTMLElement>,
    track: HTMLElement,
  ) => {
    const rect = track.getBoundingClientRect();
    const raw = ((event.clientX - rect.left) / rect.width) * 1440;
    return Math.max(0, Math.min(1440, Math.round(raw / SLOT) * SLOT));
  };

  const handleDragMove = (event: PointerEvent<HTMLElement>) => {
    if (!dragState) return;
    const track = event.currentTarget.closest(
      ".timeline-track",
    ) as HTMLElement | null;
    if (!track) return;
    const minute = minuteFromPointer(event, track);

    if (dragState.kind === "meeting") {
      const meeting = meetings.find(
        (item) => item.id === dragState.meetingId,
      );
      if (!meeting) return;
      updateMeeting(meeting.id, {
        start: Math.max(
          0,
          Math.min(1440 - meeting.duration, minute - meeting.duration / 2),
        ),
      });
    } else if (dragState.kind === "duration") {
      const meeting = meetings.find(
        (item) => item.id === dragState.meetingId,
      );
      if (!meeting) return;
      updateMeeting(meeting.id, {
        duration: Math.max(
          MIN_MEETING,
          Math.min(MAX_DAY_MINUTES - meeting.start, minute - meeting.start),
        ),
      });
    } else {
      const zone = zones.find((item) => item.id === dragState.zoneId);
      if (!zone) return;
      const local = zonedParts(instantAt(minute), zone.timeZone);
      updateHours(zone.id, dragState.dayIndex, {
        [dragState.edge]: local.minutes,
      });
    }
  };

  const startDrag = (
    event: PointerEvent<HTMLElement>,
    state: NonNullable<DragState>,
  ) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState(state);
    if ("meetingId" in state) setSelectedMeetingId(state.meetingId);
  };

  const setMeetingDuration = (meeting: Meeting, requested: number) => {
    if (!Number.isFinite(requested)) return;
    const duration = Math.max(
      MIN_MEETING,
      Math.min(MAX_DAY_MINUTES, Math.round(requested)),
    );
    updateMeeting(meeting.id, {
      duration,
      start: Math.min(meeting.start, MAX_DAY_MINUTES - duration),
    });
  };

  const reset = () => {
    setZones(DEFAULT_ZONES);
    setMeetings([
      { id: "meeting-1", date: selectedDate, start: 8 * 60, duration: 30 },
    ]);
    setSelectedMeetingId("meeting-1");
    setReferenceId("mountain");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span>timefold</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Help">
            <CircleHelp size={19} />
          </button>
          <div className="avatar" title="Local workspace">
            DP
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <span className="eyebrow">Your team</span>
              <h2>Time zones</h2>
            </div>
            <button className="icon-button subtle" aria-label="Collapse sidebar">
              <PanelLeftClose size={18} />
            </button>
          </div>
          <p className="sidebar-copy">
            Choose a reference zone, then compare everyone on the same timeline.
          </p>
          <div className="zone-list">
            {zones.map((zone) => {
              const now = zonedParts(new Date(), zone.timeZone);
              return (
                <button
                  key={zone.id}
                  className={`zone-card ${referenceId === zone.id ? "active" : ""}`}
                  onClick={() => setReferenceId(zone.id)}
                >
                  <span
                    className="zone-avatar"
                    style={{ "--zone-color": zone.color } as React.CSSProperties}
                  >
                    {zone.initials}
                  </span>
                  <span className="zone-card-copy">
                    <strong>{zone.city}</strong>
                    <small>{zone.label}</small>
                  </span>
                  <span className="zone-now">
                    <strong>{formatTime(now.minutes)}</strong>
                    <small>{now.day.split(",")[0]}</small>
                  </span>
                  {referenceId === zone.id && (
                    <span className="reference-badge">
                      <Check size={11} /> Base
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="sidebar-meetings">
            <div className="sidebar-meeting-heading">
              <span>This week</span>
              <strong>{meetings.filter((meeting) => dates.includes(meeting.date)).length}</strong>
            </div>
            {meetings
              .filter((meeting) => dates.includes(meeting.date))
              .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
              .map((meeting, index) => (
                <button
                  key={meeting.id}
                  className={meeting.id === selectedMeetingId ? "active" : ""}
                  onClick={() => {
                    chooseDate(meeting.date);
                    setSelectedMeetingId(meeting.id);
                  }}
                >
                  <i style={{ background: MEETING_COLORS[index % MEETING_COLORS.length] }} />
                  <span>
                    {WEEKDAYS[weekdayIndex(meeting.date)]} · {formatTime(meeting.start)}
                  </span>
                  <small>{formatDuration(meeting.duration)}</small>
                </button>
              ))}
          </div>
          <div className="sidebar-footer">
            <button onClick={reset}>
              <RotateCcw size={15} />
              Reset workspace
            </button>
            <span>Saved locally</span>
          </div>
        </aside>

        <section className="main-content">
          <div className="page-intro">
            <div>
              <span className="eyebrow">Team overlap planner</span>
              <h1>Plan a fair week for everyone.</h1>
              <p>
                Compare the whole week, then fine-tune each day without booking anything.
              </p>
            </div>
            <div className="intro-controls">
              <div className="view-toggle">
                <button
                  className={view === "day" ? "active" : ""}
                  onClick={() => setView("day")}
                >
                  Day
                </button>
                <button
                  className={view === "week" ? "active" : ""}
                  onClick={() => setView("week")}
                >
                  Week
                </button>
              </div>
              <div className="date-control">
                <CalendarDays size={17} />
                <div>
                  <span>{view === "week" ? "Week containing" : "Compare date"}</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(event) => chooseDate(event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {view === "week" && (
            <section className="week-card">
              <div className="week-card-heading">
                <div>
                  <span className="eyebrow">Week at a glance</span>
                  <h2>
                    {formatShortDate(dates[0])}–{formatShortDate(dates[6])}
                  </h2>
                </div>
                <span>Shared in-hours overlap · {referenceZone.initials}</span>
              </div>
              <div className="week-scroller">
                <div className="week-grid">
                  <div className="week-hours week-label-spacer" />
                  <div className="week-hours">
                    {Array.from({ length: 24 }, (_, hour) => (
                      <span key={hour}>{formatTime(hour * 60, true)}</span>
                    ))}
                  </div>
                  {dates.map((date) => {
                    const plan = weekPlans[date];
                    const dayMeetings = meetings.filter(
                      (meeting) => meeting.date === date,
                    );
                    return (
                      <div className="week-row" key={date}>
                        <button
                          className={`week-day-label ${date === selectedDate ? "active" : ""}`}
                          onClick={() => chooseDate(date)}
                        >
                          <span>{WEEKDAYS[weekdayIndex(date)]}</span>
                          <strong>{formatShortDate(date)}</strong>
                          <small>
                            {plan.overlap.reduce(
                              (total, segment) => total + segment.end - segment.start,
                              0,
                            ) / 60}
                            h overlap
                          </small>
                        </button>
                        <div className="week-track">
                          <div className="hour-grid" />
                          {plan.overlap.map((segment, index) => (
                            <button
                              key={index}
                              className="week-overlap"
                              style={{
                                left: `${(segment.start / 1440) * 100}%`,
                                width: `${((segment.end - segment.start) / 1440) * 100}%`,
                              }}
                              onClick={() => {
                                chooseDate(date);
                                addMeeting(date, segment.start);
                              }}
                              title={`Add a meeting at ${formatTime(segment.start)}`}
                            />
                          ))}
                          {dayMeetings.map((meeting, index) => (
                            <button
                              key={meeting.id}
                              className={`week-meeting ${meeting.id === selectedMeetingId ? "selected" : ""}`}
                              style={{
                                left: `${(meeting.start / 1440) * 100}%`,
                                width: `${(meeting.duration / 1440) * 100}%`,
                                background:
                                  MEETING_COLORS[
                                    meetings.indexOf(meeting) % MEETING_COLORS.length
                                  ],
                                top: `${9 + index * 12}px`,
                              }}
                              onClick={() => {
                                chooseDate(date);
                                setSelectedMeetingId(meeting.id);
                              }}
                              title={`${formatTime(meeting.start)} · ${formatDuration(meeting.duration)}`}
                            />
                          ))}
                          <button
                            className="week-add"
                            onClick={() => addMeeting(date)}
                            aria-label={`Add meeting on ${formatLongDate(date)}`}
                          >
                            <Plus size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          <section className="planner-card">
            <div className="planner-toolbar">
              <div className="selected-day-title">
                <span className="eyebrow">Selected day</span>
                <strong>{formatLongDate(selectedDate)}</strong>
              </div>
              <div className="toolbar-actions">
                {selectedMeeting && selectedMeeting.date === selectedDate && (
                  <div className="toolbar-group">
                    <span className="toolbar-label">Length</span>
                    <div className="segmented-control">
                      {DURATION_OPTIONS.map((option) => (
                        <button
                          key={option}
                          className={
                            selectedMeeting.duration === option ? "selected" : ""
                          }
                          onClick={() =>
                            setMeetingDuration(selectedMeeting, option)
                          }
                        >
                          {option < 60 ? `${option}m` : `${option / 60}h`}
                        </button>
                      ))}
                    </div>
                    <label className="custom-duration">
                      <input
                        type="number"
                        min={MIN_MEETING}
                        max={MAX_DAY_MINUTES}
                        value={selectedMeeting.duration}
                        aria-label="Custom meeting length in minutes"
                        onChange={(event) => {
                          if (event.target.value === "") return;
                          setMeetingDuration(
                            selectedMeeting,
                            Number(event.target.value),
                          );
                        }}
                      />
                      <span>min</span>
                    </label>
                  </div>
                )}
                <button className="add-meeting-button" onClick={() => addMeeting()}>
                  <ListPlus size={16} />
                  Add meeting
                </button>
                <button
                  className={`edit-hours-button ${editingHours ? "active" : ""}`}
                  onClick={() => setEditingHours((current) => !current)}
                >
                  <Clock3 size={16} />
                  Working hours
                  <ChevronDown
                    size={14}
                    style={{
                      transform: editingHours ? "rotate(180deg)" : undefined,
                    }}
                  />
                </button>
              </div>
            </div>

            {editingHours && (
              <div className="hours-editor weekly">
                <div className="hours-editor-title">
                  <div>
                    <h3>Weekly working hours</h3>
                    <p>Times are local to each team. Type any start and end time.</p>
                  </div>
                  <button
                    className="icon-button subtle"
                    onClick={() => setEditingHours(false)}
                    aria-label="Close working hours editor"
                  >
                    <X size={17} />
                  </button>
                </div>
                <div className="weekday-tabs">
                  {WEEKDAYS.map((day, index) => (
                    <button
                      key={day}
                      className={editorDay === index ? "active" : ""}
                      onClick={() => setEditorDay(index)}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                <div className="hours-editor-grid">
                  {zones.map((zone) => {
                    const hours = zone.schedule[editorDay];
                    return (
                      <div className={`hours-row ${!hours.enabled ? "disabled" : ""}`} key={zone.id}>
                        <span className="zone-dot" style={{ background: zone.color }} />
                        <div>
                          <strong>{zone.city}</strong>
                          <small>{zone.initials} · local time</small>
                        </div>
                        <label className="day-enabled">
                          <input
                            type="checkbox"
                            checked={hours.enabled}
                            onChange={(event) =>
                              updateHours(zone.id, editorDay, {
                                enabled: event.target.checked,
                              })
                            }
                          />
                          <span>{hours.enabled ? "Working" : "Off"}</span>
                        </label>
                        <TimeField
                          label={`${zone.city} start`}
                          value={hours.start}
                          disabled={!hours.enabled}
                          onChange={(start) =>
                            updateHours(zone.id, editorDay, { start })
                          }
                        />
                        <span className="to">to</span>
                        <TimeField
                          label={`${zone.city} end`}
                          value={hours.end}
                          disabled={!hours.enabled}
                          onChange={(end) =>
                            updateHours(zone.id, editorDay, { end })
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="hours-editor-footer">
                  <span>
                    Editing {WEEKDAYS[editorDay]} independently
                  </span>
                  <button onClick={copyEditorDayToWeekdays}>
                    <Copy size={13} /> Apply {WEEKDAYS[editorDay]} to Mon–Fri
                  </button>
                </div>
              </div>
            )}

            <div className="timeline-scroller">
              <div className="timeline">
                <div className="timeline-header timeline-label-cell">
                  <span>LOCAL TIME</span>
                  <small>Drag edges to adjust hours</small>
                </div>
                <div className="timeline-header timeline-hours">
                  {Array.from({ length: 24 }, (_, hour) => (
                    <span key={hour}>{formatTime(hour * 60, true)}</span>
                  ))}
                </div>

                {zones.map((zone) => (
                  <div className="timeline-row" key={zone.id}>
                    <div className="timeline-label-cell row-label">
                      <span className="zone-dot" style={{ background: zone.color }} />
                      <div>
                        <strong>{zone.city}</strong>
                        <small>
                          {zone.initials}
                          {referenceId === zone.id && " · BASE"}
                        </small>
                      </div>
                      <span className="row-work-hours">
                        {WEEKDAYS[editorDay]}{" "}
                        {zone.schedule[editorDay].enabled
                          ? `${formatTime(zone.schedule[editorDay].start)}–${formatTime(zone.schedule[editorDay].end)}`
                          : "Off"}
                      </span>
                    </div>
                    <div
                      className={`timeline-track ${dragState ? "dragging" : ""}`}
                      onPointerDown={(event) => {
                        const meeting =
                          meetings.find(
                            (item) =>
                              item.id === selectedMeetingId &&
                              item.date === selectedDate,
                          ) ?? meetingsToday[0];
                        const minute = minuteFromPointer(
                          event,
                          event.currentTarget,
                        );
                        if (!meeting) {
                          addMeeting(selectedDate, minute);
                          return;
                        }
                        setSelectedMeetingId(meeting.id);
                        updateMeeting(meeting.id, {
                          start: Math.max(
                            0,
                            Math.min(
                              1440 - meeting.duration,
                              minute - meeting.duration / 2,
                            ),
                          ),
                        });
                      }}
                    >
                      <div className="hour-grid" />
                      <div className="night-shade left" />
                      <div className="night-shade right" />
                      {dayPlan.work[zone.id]?.map((segment, index) => (
                        <div
                          className="work-block resizable"
                          key={`${zone.id}-${segment.dayIndex}-${index}`}
                          style={{
                            left: `${(segment.start / 1440) * 100}%`,
                            width: `${((segment.end - segment.start) / 1440) * 100}%`,
                            "--zone-color": zone.color,
                          } as React.CSSProperties}
                        >
                          <button
                            className="resize-edge start"
                            aria-label={`Adjust ${zone.city} workday start`}
                            onPointerDown={(event) =>
                              startDrag(event, {
                                kind: "work",
                                zoneId: zone.id,
                                edge: "start",
                                dayIndex: segment.dayIndex ?? weekdayIndex(selectedDate),
                              })
                            }
                            onPointerMove={handleDragMove}
                            onPointerUp={() => setDragState(null)}
                            onPointerCancel={() => setDragState(null)}
                          />
                          <button
                            className="resize-edge end"
                            aria-label={`Adjust ${zone.city} workday end`}
                            onPointerDown={(event) =>
                              startDrag(event, {
                                kind: "work",
                                zoneId: zone.id,
                                edge: "end",
                                dayIndex: segment.dayIndex ?? weekdayIndex(selectedDate),
                              })
                            }
                            onPointerMove={handleDragMove}
                            onPointerUp={() => setDragState(null)}
                            onPointerCancel={() => setDragState(null)}
                          />
                        </div>
                      ))}
                      {meetingsToday.map((meeting, index) => {
                        const details = zonedParts(
                          instantAt(meeting.start),
                          zone.timeZone,
                        );
                        const end = zonedParts(
                          instantAt(meeting.start + meeting.duration),
                          zone.timeZone,
                        );
                        const isSelected = meeting.id === selectedMeetingId;
                        return (
                          <div
                            key={meeting.id}
                            className={`meeting-block multi ${isSelected ? "selected" : ""}`}
                            style={{
                              left: `${(meeting.start / 1440) * 100}%`,
                              width: `${(meeting.duration / 1440) * 100}%`,
                              top: `${9 + (index % 3) * 19}px`,
                              "--meeting-color":
                                MEETING_COLORS[
                                  meetings.indexOf(meeting) %
                                    MEETING_COLORS.length
                                ],
                            } as React.CSSProperties}
                            onPointerDown={(event) =>
                              startDrag(event, {
                                kind: "meeting",
                                meetingId: meeting.id,
                              })
                            }
                            onPointerMove={handleDragMove}
                            onPointerUp={() => setDragState(null)}
                            onPointerCancel={() => setDragState(null)}
                          >
                            {isSelected && (
                              <>
                                <span className="meeting-local-time">
                                  {formatTime(details.minutes)}–{formatTime(end.minutes)}
                                </span>
                                <button
                                  className="meeting-resize"
                                  aria-label="Resize meeting"
                                  onPointerDown={(event) =>
                                    startDrag(event, {
                                      kind: "duration",
                                      meetingId: meeting.id,
                                    })
                                  }
                                  onPointerMove={handleDragMove}
                                  onPointerUp={() => setDragState(null)}
                                  onPointerCancel={() => setDragState(null)}
                                >
                                  <GripVertical size={11} />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="overlap-row">
                  <div className="timeline-label-cell overlap-label">
                    <Sparkles size={15} />
                    <div>
                      <strong>Shared overlap</strong>
                      <small>All zones in-hours</small>
                    </div>
                  </div>
                  <div className="overlap-track">
                    <div className="hour-grid" />
                    {dayPlan.overlap.map((segment, index) => (
                      <button
                        key={index}
                        className="overlap-block"
                        style={{
                          left: `${(segment.start / 1440) * 100}%`,
                          width: `${((segment.end - segment.start) / 1440) * 100}%`,
                        }}
                        onClick={() => {
                          if (selectedMeeting) {
                            updateMeeting(selectedMeeting.id, {
                              date: selectedDate,
                              start: segment.start,
                            });
                          } else {
                            addMeeting(selectedDate, segment.start);
                          }
                        }}
                        title={`Move meeting to ${formatTime(segment.start)} ${referenceZone.initials}`}
                      />
                    ))}
                    {dayPlan.overlap.length === 0 && (
                      <span className="no-overlap">
                        No time is inside everyone&apos;s working hours
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="timeline-legend">
              <span>
                <i className="legend-swatch work" /> Working hours
              </span>
              <span>
                <i className="legend-swatch meeting" /> Meetings
              </span>
              <span className="drag-tip">
                <GripVertical size={14} /> Drag meetings or their right edge
              </span>
            </div>
          </section>

          {selectedMeeting && selectedMeeting.date === selectedDate ? (
            <section className="impact-section">
              <div className="impact-heading">
                <div>
                  <span className="eyebrow">Selected meeting impact</span>
                  <h2>
                    {formatTime(selectedMeeting.start)}–
                    {formatTime(selectedMeeting.start + selectedMeeting.duration)}{" "}
                    <span>{referenceZone.initials}</span>
                  </h2>
                </div>
                <div className="impact-heading-actions">
                  <button
                    className="delete-meeting"
                    onClick={() => deleteMeeting(selectedMeeting.id)}
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                  <div className="score-pill">
                    <span
                      className="score-ring"
                      style={{ "--score": score } as React.CSSProperties}
                    >
                      {score}
                    </span>
                    <div>
                      <strong>
                        {score === 100
                          ? "Great fit"
                          : score >= 50
                            ? "Possible"
                            : "Tough fit"}
                      </strong>
                      <small>
                        {fullyWithin} of {zones.length} in hours
                      </small>
                    </div>
                  </div>
                </div>
              </div>
              <div className="impact-grid">
                {meetingDetails.map(({ zone, start, end, status }) => {
                  const Icon = getDaylightIcon(start.minutes);
                  return (
                    <article className="impact-card" key={zone.id}>
                      <div className="impact-card-top">
                        <span
                          className="zone-avatar small"
                          style={
                            { "--zone-color": zone.color } as React.CSSProperties
                          }
                        >
                          {zone.initials}
                        </span>
                        <span className={`status-badge ${status}`}>
                          {status === "within"
                            ? "In hours"
                            : status === "partial"
                              ? "Partly outside"
                              : "Outside hours"}
                        </span>
                      </div>
                      <h3>{zone.city}</h3>
                      <div className="impact-time">
                        <Icon size={17} />
                        <strong>{formatTime(start.minutes)}</strong>
                        <span>–</span>
                        <strong>{formatTime(end.minutes)}</strong>
                      </div>
                      <p>{start.day}</p>
                    </article>
                  );
                })}
              </div>
              <div className={`recommendation ${bestWindow ? "" : "warning"}`}>
                <div className="recommendation-icon">
                  {bestWindow ? <Sparkles size={18} /> : <Users size={18} />}
                </div>
                <div>
                  <strong>
                    {bestWindow
                      ? `A ${formatDuration(selectedMeeting.duration)} shared window starts at ${formatTime(bestWindow.start)} ${referenceZone.initials}`
                      : "This duration doesn’t fit the full-team overlap"}
                  </strong>
                  <p>
                    {bestWindow
                      ? "Use different windows across the week to share the early and late meetings fairly."
                      : "Adjust one day’s hours or shorten the meeting to create a shared window."}
                  </p>
                </div>
                {bestWindow && selectedMeeting.start !== bestWindow.start && (
                  <button
                    onClick={() =>
                      updateMeeting(selectedMeeting.id, {
                        start: bestWindow.start,
                      })
                    }
                  >
                    Use this time
                  </button>
                )}
              </div>
            </section>
          ) : (
            <div className="empty-meeting">
              <ListPlus size={22} />
              <div>
                <strong>No meeting selected for {formatLongDate(selectedDate)}</strong>
                <p>Add one to compare its impact across all four time zones.</p>
              </div>
              <button onClick={() => addMeeting()}>Add meeting</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
