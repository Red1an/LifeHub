import { useEffect, type ReactNode } from "react";
import { defineModule, useNavigate, useParams } from "@lifehub/sdk";
import "./styles.css";
import { StorageGate } from "./lib/storage";
import { migrateOldSongs, SEED } from "./lib/songs";
import { PracticeWidget } from "./widget";
import { TodayPage } from "./pages/Today";
import { SongsPage } from "./pages/Songs";
import { SongPage } from "./pages/Song";
import { ChordsPage } from "./pages/Chords";
import { LearnPage, LearnPathPage } from "./pages/Learn";
import { TrainPage } from "./pages/Train";
import { ToolsPage } from "./pages/Tools";
import { ProgressPage } from "./pages/Progress";
import NewSongPage from "./pages/NewSong";
import Bend from "./pages/train/bend";
import Breath from "./pages/train/breath";
import Caged from "./pages/train/caged";
import CallResponse from "./pages/train/call-response";
import ChordChanges from "./pages/train/chord-changes";
import ChordCheck from "./pages/train/chord-check";
import ChordsEar from "./pages/train/chords";
import Fingerstyle from "./pages/train/fingerstyle";
import Fretboard from "./pages/train/fretboard";
import Harmony from "./pages/train/harmony";
import Intervals from "./pages/train/intervals";
import Jam from "./pages/train/jam";
import KeyFinder from "./pages/train/key-finder";
import PitchGraph from "./pages/train/pitch-graph";
import PitchMatch from "./pages/train/pitch-match";
import Progressions from "./pages/train/progressions";
import Rhythm from "./pages/train/rhythm";
import RhythmMic from "./pages/train/rhythm-mic";
import RhythmReading from "./pages/train/rhythm-reading";
import Scales from "./pages/train/scales";
import SingInterval from "./pages/train/sing-interval";
import Speed from "./pages/train/speed";
import Sustain from "./pages/train/sustain";
import VocalRange from "./pages/train/vocal-range";
import Warmup from "./pages/train/warmup";

function Layout({ children }: { children: ReactNode }) {
  useEffect(() => {
    void migrateOldSongs();
  }, []);
  return (
    <StorageGate>
      <div className="gt-root flex min-h-full flex-1 flex-col">{children}</div>
    </StorageGate>
  );
}

/** Старые ссылки /songs/<slug> → /song/<id>. */
function LegacySong() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    navigate(SEED.some((s) => s.id === `s-${slug}`) ? `/song/s-${slug}` : `/song/u-${slug}`, { replace: true });
  }, [slug]);
  return null;
}

export default defineModule({
  routes: {
    "/": TodayPage,
    "/songs": SongsPage,
    "/songs/new": NewSongPage,
    "/songs/:slug": LegacySong,
    "/song/:id": SongPage,
    "/chords": ChordsPage,
    "/learn": LearnPage,
    "/learn/:id": LearnPathPage,
    "/train": TrainPage,
    "/tools": ToolsPage,
    "/practice": ToolsPage,
    "/progress": ProgressPage,
    "/train/bend": Bend,
    "/train/breath": Breath,
    "/train/caged": Caged,
    "/train/call-response": CallResponse,
    "/train/chord-changes": ChordChanges,
    "/train/chord-check": ChordCheck,
    "/train/chords": ChordsEar,
    "/train/fingerstyle": Fingerstyle,
    "/train/fretboard": Fretboard,
    "/train/harmony": Harmony,
    "/train/intervals": Intervals,
    "/train/jam": Jam,
    "/train/key-finder": KeyFinder,
    "/train/pitch-graph": PitchGraph,
    "/train/pitch-match": PitchMatch,
    "/train/progressions": Progressions,
    "/train/rhythm": Rhythm,
    "/train/rhythm-mic": RhythmMic,
    "/train/rhythm-reading": RhythmReading,
    "/train/scales": Scales,
    "/train/sing-interval": SingInterval,
    "/train/speed": Speed,
    "/train/sustain": Sustain,
    "/train/vocal-range": VocalRange,
    "/train/warmup": Warmup,
    "*": TodayPage,
  },
  nav: [
    { to: "/", label: "Сегодня", icon: "🏠" },
    { to: "/songs", label: "Песни", icon: "🎵" },
    { to: "/chords", label: "Аккорды", icon: "🎼" },
    { to: "/learn", label: "Учёба", icon: "🧭" },
    { to: "/train", label: "Тренажёры", icon: "🎯" },
  ],
  layout: Layout,
  theme: "dark",
  widgets: {
    practice: { title: "Гитара", size: "sm", component: PracticeWidget },
  },
});
