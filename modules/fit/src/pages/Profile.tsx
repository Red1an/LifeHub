import { useState, type ReactNode } from "react";
import { cn, confirm, Loading, media, prompt, toast, uid } from "@lifehub/sdk";
import { EQUIP, EX, LIMITS } from "../data/library.ts";
import { useFit } from "../lib/store.ts";
import type { Equip, Experience, Goal, Limitation, Place, Profile } from "../lib/types.ts";
import { Btn, Chip, Header, Panel, Screen, Section } from "../components/kit.tsx";

export const GOALS: Record<Goal, { title: string; icon: string; text: string }> = {
  health: { title: "Здоровье и тонус", icon: "❤️", text: "Держать тело в форме, спина без боли" },
  strength: { title: "Сила", icon: "🏋️", text: "Тяжелее, меньше повторов, больше отдых" },
  muscle: { title: "Мышцы", icon: "💪", text: "Объём: 8–12 повторов" },
  endurance: { title: "Выносливость", icon: "🏃", text: "Много повторов, короткий отдых" },
  fatloss: { title: "Похудение", icon: "🔥", text: "Плотные тренировки и интервалы" },
};

export const EXPERIENCE: Record<Experience, { title: string; text: string }> = {
  1: { title: "Новичок", text: "Давно не тренировался или только начинаю" },
  2: { title: "Средний", text: "Тренируюсь время от времени, базу знаю" },
  3: { title: "Продвинутый", text: "Регулярно тренируюсь больше года" },
};

export function Choice<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; title: string; icon?: string; text?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button key={String(o.v)} type="button" onClick={() => onChange(o.v)}
          className={cn("flex items-center gap-3 rounded-2xl border p-3 text-left transition", o.v === value ? "border-[var(--ft-lime)] bg-[var(--ft-lime)]/12" : "border-[var(--ft-line)] bg-[var(--ft-panel)] hover:brightness-125")}>
          {o.icon && <span className="text-2xl">{o.icon}</span>}
          <span className="min-w-0">
            <span className="block font-bold">{o.title}</span>
            {o.text && <span className="block text-xs text-[var(--ft-muted)]">{o.text}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 mt-4 text-xs font-extrabold uppercase tracking-widest text-[var(--ft-muted)]">{children}</div>;
}

export function Numbers({ value, list, onChange, suffix = "" }: { value: number; list: number[]; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="ft-scroll-x">
      {list.map((n) => <Chip key={n} on={n === value} onClick={() => onChange(n)}>{n}{suffix}</Chip>)}
    </div>
  );
}

export function PlacesEditor({ places, onChange }: { places: Place[]; onChange: (p: Place[]) => void }) {
  const [open, setOpen] = useState<string | null>(places[0]?.id ?? null);
  const upd = (id: string, patch: Partial<Place>) => onChange(places.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const toggle = (p: Place, q: Equip) => upd(p.id, { equip: p.equip.includes(q) ? p.equip.filter((x) => x !== q) : [...p.equip, q] });
  const add = async () => {
    const name = await prompt("Название места (например, «Дача»)", "");
    if (!name) return;
    const id = uid();
    onChange([...places, { id, name, icon: "📍", equip: ["chair", "wall"] }]);
    setOpen(id);
  };
  return (
    <div className="space-y-2">
      {places.map((p) => (
        <div key={p.id} className="ft-panel overflow-hidden">
          <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="text-2xl">{p.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{p.name}</span>
              <span className="block truncate text-xs text-[var(--ft-muted)]">{p.equip.length ? p.equip.map((q) => EQUIP[q].name).join(", ") : "только своё тело"}</span>
            </span>
            <span className="text-[var(--ft-muted)]">{open === p.id ? "▴" : "▾"}</span>
          </button>
          {open === p.id && (
            <div className="border-t border-[var(--ft-line)] p-3">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(EQUIP) as Equip[]).map((q) => (
                  <Chip key={q} on={p.equip.includes(q)} onClick={() => toggle(p, q)}>{EQUIP[q].icon} {EQUIP[q].name}</Chip>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Btn tone="ghost" className="!min-h-9 text-sm" onClick={async () => { const n = await prompt("Название", p.name); if (n) upd(p.id, { name: n }); }}>Переименовать</Btn>
                <Btn tone="ghost" className="!min-h-9 text-sm" onClick={async () => { const n = await prompt("Эмодзи-иконка", p.icon); if (n) upd(p.id, { icon: n }); }}>Иконка</Btn>
                {places.length > 1 && (
                  <Btn tone="red" className="!min-h-9 text-sm" onClick={async () => { if (await confirm(`Удалить «${p.name}»?`, { danger: true })) onChange(places.filter((x) => x.id !== p.id)); }}>Удалить</Btn>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
      <button className="ft-chip w-full justify-center" onClick={() => void add()}>+ Добавить место</button>
    </div>
  );
}

export function LimitsEditor({ value, onChange }: { value: Limitation[]; onChange: (v: Limitation[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(LIMITS) as Limitation[]).map((l) => (
        <Chip key={l} on={value.includes(l)} onClick={() => onChange(value.includes(l) ? value.filter((x) => x !== l) : [...value, l])}>{LIMITS[l]}</Chip>
      ))}
    </div>
  );
}

export function ProfilePage() {
  const fit = useFit();
  if (fit.loading) return <Screen><Loading /></Screen>;
  const p = fit.profile;
  const set = (patch: Partial<Profile>) => fit.setProfile({ ...p, ...patch });

  return (
    <Screen>
      <Header title="Настройки" subtitle="Под тебя подстраиваются все тренировки" back="/" />

      <Section title="Уровень и цель" className="!mt-0">
        <Choice value={p.experience} onChange={(v) => set({ experience: v })} options={([1, 2, 3] as Experience[]).map((v) => ({ v, ...EXPERIENCE[v] }))} />
        <Label>Цель</Label>
        <Choice value={p.goal} onChange={(v) => set({ goal: v })} options={(Object.keys(GOALS) as Goal[]).map((v) => ({ v, ...GOALS[v] }))} />
        <Label>Тренировок в неделю</Label>
        <Numbers value={p.perWeek} list={[1, 2, 3, 4, 5, 6]} onChange={(v) => set({ perWeek: v })} />
        <div className="mt-1 text-xs text-[var(--ft-muted)]">
          {p.perWeek <= 3 ? "Всё тело каждый раз" : p.perWeek === 4 ? "Чередуем верх и низ" : "Жимы / тяги / ноги по кругу"}
        </div>
        <Label>Длительность по умолчанию</Label>
        <Numbers value={p.minutes} list={[15, 20, 30, 45, 60]} onChange={(v) => set({ minutes: v })} suffix=" мин" />
        <Label>Вес тела, кг (необязательно)</Label>
        <input className="ft-input max-w-40" type="number" inputMode="decimal" value={p.bodyweight ?? ""} onChange={(e) => set({ bodyweight: e.target.value ? Number(e.target.value) : undefined })} />
      </Section>

      <Section title="Места и инвентарь">
        <p className="-mt-1 mb-3 text-sm text-[var(--ft-muted)]">Тренировка собирается только из того, что есть на месте.</p>
        <PlacesEditor places={p.places} onChange={(places) => set({ places, place: places.some((x) => x.id === p.place) ? p.place : places[0].id })} />
      </Section>

      <Section title="Что беречь">
        <p className="-mt-1 mb-3 text-sm text-[var(--ft-muted)]">Упражнения с нагрузкой на эти зоны не попадут в подборку.</p>
        <LimitsEditor value={p.limits} onChange={(limits) => set({ limits })} />
      </Section>

      <Section title="Разминки у стола">
        <Label>Цель в день</Label>
        <Numbers value={p.breaksPerDay} list={[2, 3, 4, 5, 6, 8]} onChange={(v) => set({ breaksPerDay: v })} />
        <Label>Напоминать каждые</Label>
        <div className="ft-scroll-x">
          {[0, 30, 45, 60, 90, 120].map((n) => <Chip key={n} on={n === p.remindEvery} onClick={() => set({ remindEvery: n })}>{n ? `${n} мин` : "не напоминать"}</Chip>)}
        </div>
        <Label>Рабочие часы</Label>
        <div className="flex items-center gap-2">
          <select className="ft-input !w-24" value={p.workFrom} onChange={(e) => set({ workFrom: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
          <span>—</span>
          <select className="ft-input !w-24" value={p.workTo} onChange={(e) => set({ workTo: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
        </div>
        <Panel className="mt-3 text-sm text-[var(--ft-muted)]">
          Напоминание приходит, пока хаб открыт во вкладке браузера (на компьютере — можно в фоне).
          <Btn tone="ghost" className="mt-2 !min-h-9 text-sm" onClick={async () => {
            try {
              const ok = await media.notify("Форма", "Так будет выглядеть напоминание размяться 🧘");
              toast(ok ? "Уведомления работают" : "Браузер не разрешил уведомления", ok ? "success" : "error");
            } catch (e) { toast((e as Error).message, "error"); }
          }}>Проверить уведомление</Btn>
        </Panel>
      </Section>

      <Section title="Звук">
        <div className="flex flex-wrap gap-2">
          <Chip on={p.sound} onClick={() => set({ sound: !p.sound })}>🔔 Сигналы таймера</Chip>
          <Chip on={p.voice} onClick={() => set({ voice: !p.voice })}>🗣️ Голосовые подсказки</Chip>
        </div>
      </Section>

      {fit.hidden.length > 0 && (
        <Section title="Скрытые упражнения">
          <div className="flex flex-wrap gap-2">
            {fit.hidden.map((id) => (
              <Chip key={id} onClick={() => fit.setHidden(fit.hidden.filter((x) => x !== id))}>{EX.get(id)?.icon} {EX.get(id)?.name ?? id} ✕</Chip>
            ))}
          </div>
        </Section>
      )}

      <Section title="Начать заново">
        <Btn tone="ghost" onClick={() => set({ onboarded: false })}>Пройти знакомство ещё раз</Btn>
      </Section>
    </Screen>
  );
}
