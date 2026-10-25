package ru.lifehub.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.service.quicksettings.TileService;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * «Спросить Джарвиса» — плитка в шторке и ярлык на иконке: распознавание речи телефоном → просьба
 * в хаб (/api/app/jarvis, тот же разбор, что у голоса на компьютере) → ответ на экране и вслух.
 */
public class Jarvis extends Activity {
    private static final int REQ = 1;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextToSpeech tts;
    private TextView said;
    private TextView answer;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Ui u = new Ui(this);
        u.text(u.root, "ДЖАРВИС", 13, Ui.MUTED, false, 4);
        said = u.text(u.root, "Слушаю…", 22, Ui.FG, true, 16);
        LinearLayout card = u.card(u.root);
        answer = u.text(card, "", 17, Ui.FG, false, 0);
        card.setVisibility(android.view.View.GONE);
        answer.setTag(card);
        u.button(u.root, "Ещё вопрос", true, v -> listen());
        u.button(u.root, "Закрыть", false, v -> finish());
        tts = new TextToSpeech(this, s -> {
            if (s == TextToSpeech.SUCCESS) tts.setLanguage(new Locale("ru", "RU"));
        });
        listen();
    }

    private void listen() {
        said.setText("Слушаю…");
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU")
                .putExtra(RecognizerIntent.EXTRA_PROMPT, "Джарвис, …");
        try {
            startActivityForResult(i, REQ);
        } catch (ActivityNotFoundException e) {
            said.setText("На телефоне нет распознавания речи (нужно приложение Google)");
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code != REQ) return;
        ArrayList<String> r = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (result != RESULT_OK || r == null || r.isEmpty()) {
            said.setText("Не расслышал");
            return;
        }
        String text = r.get(0);
        said.setText("«" + text + "»");
        show("Думаю…", false);
        new Thread(() -> {
            String reply;
            String voice = null;
            try {
                Map<String, Object> body = new LinkedHashMap<>();
                body.put("text", text);
                Map<String, String> h = new LinkedHashMap<>();
                h.put("content-type", "application/json");
                h.put("x-lifehub", "1");
                Hub.Response res = LifeHub.get().hub().call("POST", "/api/app/jarvis", h, Json.write(body).getBytes(StandardCharsets.UTF_8));
                Map<String, Object> j = Json.obj(Json.parse(res.text()));
                reply = res.status == 200 ? Json.str(j.get("text"), "") : Json.str(j.get("error"), "Хаб ответил " + res.status);
                voice = res.status == 200 ? Json.str(j.get("tts"), reply) : null;
            } catch (Exception e) {
                reply = "Нет связи с компьютером — Джарвис живёт там.";
            }
            final String out = reply;
            final String speak = voice;
            ui.post(() -> {
                show(out, true);
                // Паузы вида «sil <[300]>» — для голоса на компьютере, телефону не нужны.
                if (speak != null && !speak.isEmpty()) tts.speak(speak.replaceAll("sil\\s*<\\[\\d+\\]>", " "), TextToSpeech.QUEUE_FLUSH, null, "jarvis");
            });
        }).start();
    }

    private void show(String text, boolean done) {
        answer.setText(text);
        ((LinearLayout) answer.getTag()).setVisibility(android.view.View.VISIBLE);
        answer.setTextColor(done ? Ui.FG : Ui.MUTED);
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    /** Плитка «Джарвис» в шторке быстрых настроек. */
    public static class Tile extends TileService {
        @Override
        public void onClick() {
            Intent i = new Intent(this, Jarvis.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (Build.VERSION.SDK_INT >= 34) {
                startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE));
            } else {
                startActivityAndCollapse(i);
            }
        }
    }
}
