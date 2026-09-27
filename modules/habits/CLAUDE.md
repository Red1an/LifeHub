@../LIFEHUB_GUIDE.md

# Привычки

Список привычек, отметки по дням, серии (streak), календарь активности.

## Заметки по модулю

- Коллекция `habits`: `{ name, icon, color?, days: number[] (0=пн … 6=вс, пусто — каждый день), archived?: boolean }`.
- Коллекция `checks`: id = `${habitId}_${YYYY-MM-DD}`, `{ habitId, date }` — наличие записи = выполнено.
