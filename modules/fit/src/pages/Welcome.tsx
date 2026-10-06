import { useState } from "react";
import { cn } from "@lifehub/sdk";
import { useFit } from "../lib/store.ts";
import type { Experience, Goal, Profile } from "../lib/types.ts";
import { Btn, Screen } from "../components/kit.tsx";
import { Choice, EXPERIENCE, GOALS, Label, LimitsEditor, Numbers, PlacesEditor } from "./Profile.tsx";

/** Быстрая оценка сил → стартовые ступени лестниц. */
const TESTS: { chain: string; q: string; options: { title: string; ex: string }[] }[] = [
  {
    chain: "push", q: "Сколько отжиманий от пола сделаешь подряд?",
    options: [
      { title: "Ни одного", ex: "incline-pushup" }, { title: "1–5", ex: "knee-pushup" }, { title: "6–15", ex: "pushup" },
      { title: "16–30", ex: "diamond-pushup" }, { title: "Больше 30", ex: "archer-pushup" },
    ],
  },
  {
    chain: "pullv", q: "А подтягиваний?",
    options: [
      { title: "Не могу повиснуть надолго", ex: "dead-hang" }, { title: "Ни одного", ex: "pullup-negative" }, { title: "1–4", ex: "chinup" },
      { title: "5–10", ex: "pullup" }, { title: "Больше 10", ex: "wide-pullup" },
    ],
  },
  {
    chain: "squat", q: "Как с ногами?",
    options: [
      { title: "20 приседаний — тяжело", ex: "box-squat" }, { title: "20 приседаний легко", ex: "split-squat" },
      { title: "Делаю выпады и болгарские", ex: "bulgarian-split" }, { title: "Почти пистолетик", ex: "box-pistol" },
    ],
  },
];

export function Welcome() {
  const fit = useFit();
  const [step, setStep] = useState(0);
  const [p, setP] = useState<Profile>(fit.profile);
  const [levels, setLevels] = useState<Record<string, string>>(fit.levels);
  const set = (patch: Partial<Profile>) => setP({ ...p, ...patch });
  const total = 5;

  const finish = () => {
    fit.setLevels(levels);
    fit.setProfile({ ...p, onboarded: true });
  };

  return (
    <Screen className="flex min-h-full flex-col">
      <div className="mb-6 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div key={i} className={cn("h-1.5 flex-1 rounded-full transition", i <= step ? "bg-[var(--ft-lime)]" : "bg-[#23262d]")} />
        ))}
      </div>

      <div key={step} className="ft-slide flex-1">
        {step === 0 && (
          <div>
            <div className="text-6xl">💪</div>
            <h1 className="ft-display mt-4 text-3xl font-extrabold leading-tight">Привет! Это <span className="ft-grad-text">Форма</span></h1>
            <p className="mt-3 text-[var(--ft-muted)]">
              Тренировки, которые подстраиваются под тебя: дома, на площадке с турником, в зале со штангой — и даже у рабочего стола.
            </p>
            <ul className="mt-5 space-y-3">
              {[
                ["🧠", "Умный подбор", "учитывает инвентарь, время, восстановление мышц и баланс жимов и тяг"],
                ["📈", "Постепенное усложнение", "вес и повторы растут сами, упражнения поднимаются по лестницам навыков"],
                ["🎓", "Техника", "как делать, на что обратить внимание и частые ошибки для каждого упражнения"],
                ["🪑", "Разминки у стола", "2–4 минуты, чтобы спина и шея не страдали от сидения"],
              ].map(([i, t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="text-2xl">{i}</span>
                  <span><b>{t}</b> <span className="text-[var(--ft-muted)]">— {d}</span></span>
                </li>
              ))}
            </ul>
            <Label>Твой уровень</Label>
            <Choice value={p.experience} onChange={(v) => set({ experience: v })} options={([1, 2, 3] as Experience[]).map((v) => ({ v, ...EXPERIENCE[v] }))} />
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="ft-display text-2xl font-bold">Чего хочешь добиться?</h2>
            <div className="mt-4">
              <Choice value={p.goal} onChange={(v) => set({ goal: v })} options={(Object.keys(GOALS) as Goal[]).map((v) => ({ v, ...GOALS[v] }))} />
            </div>
            <Label>Сколько тренировок в неделю реально?</Label>
            <Numbers value={p.perWeek} list={[1, 2, 3, 4, 5, 6]} onChange={(v) => set({ perWeek: v })} />
            <div className="mt-1 text-xs text-[var(--ft-muted)]">Лучше меньше, но стабильно. Цель недели легко поднять потом.</div>
            <Label>Обычно на тренировку есть</Label>
            <Numbers value={p.minutes} list={[15, 20, 30, 45, 60]} onChange={(v) => set({ minutes: v })} suffix=" мин" />
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="ft-display text-2xl font-bold">Где тренируешься?</h2>
            <p className="mt-2 text-sm text-[var(--ft-muted)]">Отметь, что есть в каждом месте. Места можно добавить и поменять потом.</p>
            <div className="mt-4">
              <PlacesEditor places={p.places} onChange={(places) => set({ places })} />
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="ft-display text-2xl font-bold">Быстрая оценка</h2>
            <p className="mt-2 text-sm text-[var(--ft-muted)]">Чтобы сразу начать с подходящих упражнений, а не с самых простых.</p>
            {TESTS.map((t) => (
              <div key={t.chain}>
                <Label>{t.q}</Label>
                <div className="flex flex-wrap gap-2">
                  {t.options.map((o) => (
                    <button key={o.ex} type="button" data-on={levels[t.chain] === o.ex} className="ft-chip" onClick={() => setLevels({ ...levels, [t.chain]: o.ex })}>{o.title}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="ft-display text-2xl font-bold">Последнее</h2>
            <Label>Что беречь (если что-то беспокоит)</Label>
            <LimitsEditor value={p.limits} onChange={(limits) => set({ limits })} />
            <Label>Разминок у стола в день</Label>
            <Numbers value={p.breaksPerDay} list={[2, 3, 4, 5, 6]} onChange={(v) => set({ breaksPerDay: v })} />
            <Label>Напоминать размяться каждые</Label>
            <div className="ft-scroll-x">
              {[0, 45, 60, 90].map((n) => <button key={n} type="button" data-on={n === p.remindEvery} className="ft-chip" onClick={() => set({ remindEvery: n })}>{n ? `${n} мин` : "не надо"}</button>)}
            </div>
            <div className="mt-6 rounded-2xl bg-[var(--ft-orange)]/10 px-4 py-3 text-sm">
              ⚠️ Если есть травмы или хронические боли — сначала посоветуйся с врачом. Боль во время упражнения — сигнал остановиться, а не терпеть.
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex gap-2">
        {step > 0 && <Btn tone="ghost" onClick={() => setStep(step - 1)}>←</Btn>}
        {step < total - 1
          ? <Btn block className="!min-h-14 flex-1 text-lg" onClick={() => setStep(step + 1)}>Дальше</Btn>
          : <Btn block className="!min-h-14 flex-1 text-lg" onClick={finish}>Поехали 🚀</Btn>}
      </div>
    </Screen>
  );
}
