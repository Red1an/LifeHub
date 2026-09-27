import { defineModule } from "@lifehub/sdk";
import { StorageGate } from "./lib/storage";
import { PracticeWidget } from "./widget";
import Page0 from "./app/page";
import Page1 from "./app/practice/page";
import Page2 from "./app/progress/page";
import Page3 from "./app/songs/page";
import Page4 from "./app/songs/[slug]/page";
import Page5 from "./app/songs/new/page";
import Page6 from "./app/train/page";
import Page7 from "./app/train/bend/page";
import Page8 from "./app/train/breath/page";
import Page9 from "./app/train/caged/page";
import Page10 from "./app/train/call-response/page";
import Page11 from "./app/train/chord-changes/page";
import Page12 from "./app/train/chord-check/page";
import Page13 from "./app/train/chords/page";
import Page14 from "./app/train/fingerstyle/page";
import Page15 from "./app/train/fretboard/page";
import Page16 from "./app/train/harmony/page";
import Page17 from "./app/train/intervals/page";
import Page18 from "./app/train/jam/page";
import Page19 from "./app/train/key-finder/page";
import Page20 from "./app/train/pitch-graph/page";
import Page21 from "./app/train/pitch-match/page";
import Page22 from "./app/train/progressions/page";
import Page23 from "./app/train/rhythm/page";
import Page24 from "./app/train/rhythm-mic/page";
import Page25 from "./app/train/rhythm-reading/page";
import Page26 from "./app/train/scales/page";
import Page27 from "./app/train/sing-interval/page";
import Page28 from "./app/train/speed/page";
import Page29 from "./app/train/sustain/page";
import Page30 from "./app/train/vocal-range/page";
import Page31 from "./app/train/warmup/page";

export default defineModule({
  routes: {
    "/": Page0,
    "/practice": Page1,
    "/progress": Page2,
    "/songs": Page3,
    "/songs/:slug": Page4,
    "/songs/new": Page5,
    "/train": Page6,
    "/train/bend": Page7,
    "/train/breath": Page8,
    "/train/caged": Page9,
    "/train/call-response": Page10,
    "/train/chord-changes": Page11,
    "/train/chord-check": Page12,
    "/train/chords": Page13,
    "/train/fingerstyle": Page14,
    "/train/fretboard": Page15,
    "/train/harmony": Page16,
    "/train/intervals": Page17,
    "/train/jam": Page18,
    "/train/key-finder": Page19,
    "/train/pitch-graph": Page20,
    "/train/pitch-match": Page21,
    "/train/progressions": Page22,
    "/train/rhythm": Page23,
    "/train/rhythm-mic": Page24,
    "/train/rhythm-reading": Page25,
    "/train/scales": Page26,
    "/train/sing-interval": Page27,
    "/train/speed": Page28,
    "/train/sustain": Page29,
    "/train/vocal-range": Page30,
    "/train/warmup": Page31,
  },
  nav: [
    { to: "/songs", label: "Песни", icon: "🎵" },
    { to: "/train", label: "Тренажёры", icon: "🎯" },
    { to: "/practice", label: "Инструменты", icon: "🎛️" },
    { to: "/progress", label: "Прогресс", icon: "📊" },
  ],
  layout: StorageGate,
  widgets: {
    practice: { title: "Гитара", component: PracticeWidget },
  },
});
