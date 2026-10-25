package ru.lifehub.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * «Зачем пришёл?» поверх YouTube/Инсты и итог, когда время вышло (extra done).
 * Обратный отсчёт идёт, только пока экран на виду. «Назад» и «Передумал» — на рабочий стол.
 */
public class GateActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Ui ui;
    private String site;
    private String pkg;
    private int left;
    private int waited;
    private int minutes;
    private boolean resumed;
    private EditText purpose;
    private Button go;

    private final Runnable countdown = new Runnable() {
        @Override
        public void run() {
            if (!resumed || left <= 0) return;
            left--;
            render();
            if (left > 0) handler.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        show(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        show(i);
    }

    private void show(Intent i) {
        handler.removeCallbacks(countdown);
        site = i.getStringExtra("site");
        pkg = i.getStringExtra("pkg");
        if (site == null) {
            finish();
            return;
        }
        ui = new Ui(this);
        if (i.getBooleanExtra("done", false)) showDone();
        else showGate();
    }

    private void showGate() {
        Store st = Store.get(this);
        // Сеанс уже идёт (открыли второй раз) — сразу обратно в приложение.
        JSONObject cur = st.session(site);
        if (cur != null && cur.optLong("endsAt") > System.currentTimeMillis()) {
            openApp();
            return;
        }
        Store.Info info = st.gateInfo(site);
        LinearLayout r = ui.root;
        ui.text(r, info.siteName.toUpperCase(), 13, Ui.MUTED, false, 4);
        ui.text(r, "Зачем пришёл?", 32, Ui.FG, true, 8);
        String today = "Сегодня здесь: " + info.todayMin + " мин" + (info.dailyMin > 0 ? " из " + info.dailyMin : "")
                + ", " + info.todayCount + " " + Ui.plural(info.todayCount, "заход", "захода", "заходов") + ".";
        if (info.limit) today += " Лимит на сегодня исчерпан.";
        if (info.work) today += " Сейчас рабочее время — ждать дольше.";
        ui.text(r, today, 15, info.limit ? Ui.WARN : Ui.MUTED, false, 24);

        purpose = ui.input(r, "Например: ролик про RAG для работы");
        ui.text(r, "Одной фразой: что конкретно хочешь найти или посмотреть.", 13, Ui.MUTED, false, 20);
        ui.text(r, "Сколько времени", 13, Ui.MUTED, false, 8);
        LinearLayout row = ui.chipsRow(r);
        minutes = info.minutes[0];
        for (int m : info.minutes) if (m == 10) minutes = 10;
        final List<Button> chips = new ArrayList<>();
        for (final int m : info.minutes) {
            final Button c = ui.chip(row, m + " мин", null);
            c.setTag(m);
            chips.add(c);
            c.setOnClickListener(v -> {
                minutes = m;
                for (Button x : chips) ui.chipState(x, (int) x.getTag() == minutes);
                render();
            });
            ui.chipState(c, m == minutes);
        }
        go = ui.button(r, "", true, v -> enter());
        purpose.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {
            }

            public void onTextChanged(CharSequence s, int a, int b, int c) {
            }

            public void afterTextChanged(Editable e) {
                render();
            }
        });
        left = info.wait;
        waited = info.wait;
        render();

        JSONObject p = left > 0 ? st.nextPuzzle() : null;
        if (p != null) puzzle(p);

        ui.button(r, "Передумал — закрыть", false, v -> home());
    }

    private void puzzle(JSONObject p) {
        LinearLayout box = ui.card(ui.root);
        ((LinearLayout.LayoutParams) box.getLayoutParams()).topMargin = ui.dp(20);
        ui.text(box, "🧩 Пока ждёшь — задачка из «Кругозора»", 13, Ui.MUTED, false, 8);
        ui.text(box, p.optString("text"), 17, Ui.FG, false, 12);
        final JSONArray opts = p.optJSONArray("options");
        final int answer = p.optInt("answer", -1);
        final TextView why = ui.text(box, p.optString("why"), 14, Ui.MUTED, false, 0);
        why.setVisibility(View.GONE);
        if (opts == null) return;
        final List<Button> buttons = new ArrayList<>();
        for (int i = 0; i < opts.length(); i++) {
            final int idx = i;
            Button b = ui.chip(box, opts.optString(i), null);
            b.setLayoutParams(new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, ui.dp(46)));
            ((LinearLayout.LayoutParams) b.getLayoutParams()).bottomMargin = ui.dp(8);
            ui.chipState(b, false);
            buttons.add(b);
            b.setOnClickListener(v -> {
                for (int k = 0; k < buttons.size(); k++) {
                    Button x = buttons.get(k);
                    x.setEnabled(false);
                    if (k == answer) x.setTextColor(Ui.ACCENT);
                    else if (k == idx) x.setTextColor(Ui.DANGER);
                }
                if (!p.optString("why").isEmpty()) why.setVisibility(View.VISIBLE);
            });
        }
        box.removeView(why);
        box.addView(why);
    }

    private boolean ready() {
        return purpose != null && purpose.getText().toString().trim().length() >= 8;
    }

    private void render() {
        if (go == null) return;
        boolean ok = left <= 0 && ready();
        Ui.setPrimaryEnabled(go, ok, ui);
        go.setText(left > 0 ? "Войти через " + left + " с" : ready() ? "Войти на " + minutes + " мин" : "Напиши цель — от 8 букв");
    }

    private void enter() {
        if (left > 0 || !ready()) return;
        Store.get(this).start(site, purpose.getText().toString().trim(), minutes, waited);
        Sync.soon(this, 0);
        openApp();
    }

    /** Вернуться в приложение, из-за которого открылись (или любое приложение этого сайта). */
    private void openApp() {
        List<String> pkgs = new ArrayList<>();
        if (pkg != null) pkgs.add(pkg);
        pkgs.addAll(Store.get(this).packagesOf(site));
        for (String p : pkgs) {
            Intent launch = getPackageManager().getLaunchIntentForPackage(p);
            if (launch != null) {
                startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                break;
            }
        }
        finish();
    }

    private void home() {
        startActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        finish();
    }

    private void showDone() {
        Store st = Store.get(this);
        JSONObject s = st.last();
        LinearLayout r = ui.root;
        ui.text(r, s.optString("siteName", "").toUpperCase(), 13, Ui.MUTED, false, 4);
        ui.text(r, "Время вышло", 32, Ui.FG, true, 8);
        if (s.has("startedAt")) {
            long min = Math.max(1, Math.round((s.optLong("endedAt") - s.optLong("startedAt")) / 60_000.0));
            ui.text(r, min + " мин. Цель была: «" + s.optString("purpose") + "».", 16, Ui.MUTED, false, 28);
        }
        ui.button(r, "Закрыть", true, v -> home());
        ui.button(r, "Ещё сеанс", false, v -> {
            ui = new Ui(this);
            showGate();
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        handler.removeCallbacks(countdown);
        if (left > 0) handler.postDelayed(countdown, 1000);
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        handler.removeCallbacks(countdown);
    }

    @Override
    public void onBackPressed() {
        home();
    }
}
