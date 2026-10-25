import { useState } from "react";
import { Link, Modal, Switch, Textarea, toast } from "@lifehub/sdk";
import { PageHead, Shell } from "../components/kit";
import { dayLabel, titleOf, useCards, usePrefs } from "../lib/store";
import { KINDS, KIND_INFO, type Kind } from "../lib/types";

/** Архив по дням с поиском и «понравилось», здесь же настройки рубрик и интересов. */
export function Archive() {
  const cards = useCards();
  const [q, setQ] = useState("");
  const [liked, setLiked] = useState(false);
  const [kind, setKind] = useState<Kind | null>(null);
  const [settings, setSettings] = useState(false);

  const query = q.trim().toLowerCase();
  const list = cards.items
    .filter((c) => c.status === "ready" && c.data)
    .filter((c) => (!liked || c.reaction === 1) && (!kind || c.kind === kind))
    .filter((c) => !query || JSON.stringify(c.data).toLowerCase().includes(query));
  const days = [...new Set(list.map((c) => c.day))].sort().reverse();
  const read = cards.items.filter((c) => c.done).length;

  return (
    <Shell>
      <PageHead
        kicker="Всё, что было"
        title="Архив"
        sub={`Прочитано карточек: ${read}`}
        right={
          <button className="horizon-btn shrink-0" onClick={() => setSettings(true)}>
            ⚙️ <span className="hidden sm:inline">Настройки</span>
          </button>
        }
      />

      <input className="horizon-input mb-3" placeholder="Поиск: Наполеон, квант, Есенин…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        <button className="horizon-chip shrink-0" data-on={liked} onClick={() => setLiked(!liked)}>
          👍 Понравилось
        </button>
        {KINDS.map((k) => (
          <button key={k} className="horizon-chip shrink-0" data-on={kind === k} onClick={() => setKind(kind === k ? null : k)}>
            {KIND_INFO[k].icon} {KIND_INFO[k].label}
          </button>
        ))}
      </div>

      {!days.length && <p className="py-10 text-center text-[#9aa3b8]">{cards.loading ? "" : "Ничего не нашлось."}</p>}

      <div className="space-y-6">
        {days.map((day) => (
          <section key={day}>
            <Link to={`/d/${day}`} className="horizon-kicker mb-2 block text-[#9aa3b8] hover:text-white">
              {dayLabel(day)} →
            </Link>
            <div className="horizon-panel divide-y divide-white/5">
              {list
                .filter((c) => c.day === day)
                .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
                .map((c) => (
                  <Link key={c.id} to={`/d/${day}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03]">
                    <span className="text-lg">{KIND_INFO[c.kind].icon}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px]">{titleOf(c).replace(/ #\d+$/, "")}</span>
                    {c.reaction === 1 && <span className="text-sm">👍</span>}
                    {c.done && <span className="text-xs text-[#9aa3b8]">✓</span>}
                  </Link>
                ))}
            </div>
          </section>
        ))}
      </div>

      <Settings open={settings} onClose={() => setSettings(false)} />
    </Shell>
  );
}

function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [prefs, setPrefs] = usePrefs();
  const [interests, setInterests] = useState(prefs.interests);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Настройки"
      footer={
        <button
          className="min-h-10 rounded-xl bg-accent px-4 font-semibold text-accent-fg"
          onClick={() => {
            setPrefs({ ...prefs, interests: interests.trim() });
            toast("Сохранено — учту с завтрашней порции", "success");
            onClose();
          }}
        >
          Сохранить
        </button>
      }
    >
      <div className="text-sm font-medium">Что тебе интересно</div>
      <Textarea
        className="mt-1.5"
        rows={3}
        value={interests}
        onChange={(e) => setInterests(e.target.value)}
        placeholder="Например: космос, история России, психология, ИИ, архитектура, музыка"
      />
      <p className="mt-1 text-xs text-muted">Нейронка подбирает историю, технологии, понятия и картины с оглядкой на это и на твои 👍/👎.</p>

      <div className="mt-5">
        <Switch
          checked={prefs.uncensored}
          onChange={(on) => setPrefs({ ...prefs, uncensored: on })}
          label="🔞 Анекдоты и цитаты без цензуры"
        />
        <p className="mt-1 text-xs text-muted">Чёрный юмор, мат, зумерские шутки и рофляные цитаты. Выключи — будет только то, что можно рассказать бабушке.</p>
      </div>

      <div className="mt-5 text-sm font-medium">Рубрики порции дня</div>
      <div className="mt-2 space-y-2.5">
        {KINDS.map((k) => (
          <Switch
            key={k}
            checked={!prefs.off.includes(k)}
            onChange={(on) => setPrefs({ ...prefs, off: on ? prefs.off.filter((x) => x !== k) : [...prefs.off, k] })}
            label={`${KIND_INFO[k].icon} ${KIND_INFO[k].label}`}
          />
        ))}
      </div>
    </Modal>
  );
}
