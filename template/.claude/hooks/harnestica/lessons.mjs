// Audit of the CLAUDE.md Lessons slot: size cap, review age and line format.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PREVIEW_LENGTH = 60;
const LESSON_LINE = /^- \[(\d{4}-\d{2}-\d{2})\s*·\s*([^\]]+)\]\s*(.+)$/;
const ENTRY_LINE = /^\s*- /;
const HARNESS_BLOCK = /<!-- harnestica:start -->([\s\S]*?)<!-- harnestica:end -->/;
const LESSONS_HEADING = /^## (?:\d+\. )?Lessons\s*$/m;
const ANY_HEADING = /^## /m;

// The Lessons slot is the harness block's "Lessons" section when the install markers exist, else the first such heading.
export function lessonsSection(markdown) {
  const block = markdown.match(HARNESS_BLOCK)?.[1] ?? markdown;
  const parts = block.split(LESSONS_HEADING);
  return parts.length > 1 ? parts[1].split(ANY_HEADING)[0] : '';
}

function parseLesson(line) {
  const match = line.match(LESSON_LINE);
  return match && { date: match[1], text: match[3] };
}

function ageInDays(lesson, now) {
  return (now - new Date(lesson.date + 'T00:00:00Z')) / MS_PER_DAY;
}

function capNote(entryCount, config) {
  if (entryCount <= config.lessonCap) return null;
  return `Harnestica: the Lessons slot holds ${entryCount}/${config.lessonCap}. Run /lesson to merge or retire before adding any.`;
}

function overdueNote(overdue, config) {
  if (!overdue.length) return null;
  const previews = overdue.map(lesson => lesson.text.slice(0, PREVIEW_LENGTH)).join(' | ');
  return `Harnestica: ${overdue.length} lesson(s) older than ${config.reviewDays} days need re-review via /lesson: ${previews}`;
}

function formatNote(badLineCount) {
  if (!badLineCount) return null;
  return `Harnestica: ${badLineCount} lesson line(s) do not match \`- [YYYY-MM-DD · scope] rule — evidence\`; fix them via /lesson.`;
}

// Returns the warnings to show at session start; empty when the slot is healthy.
export function auditLessons(markdown, config, now) {
  const entries = lessonsSection(markdown).split(/\r?\n/).filter(line => ENTRY_LINE.test(line));
  const lessons = entries.map(parseLesson).filter(Boolean);
  const malformedCount = entries.length - lessons.length;
  const overdue = lessons.filter(lesson => ageInDays(lesson, now) > config.reviewDays);
  const undatedCount = lessons.filter(lesson => Number.isNaN(ageInDays(lesson, now))).length;
  return [capNote(entries.length, config), overdueNote(overdue, config), formatNote(malformedCount + undatedCount)].filter(Boolean);
}
