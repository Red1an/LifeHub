package ru.lifehub.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.util.Iterator;
import java.util.Map;

/** Настройки приложения: связь с хабом, офлайн, обновление, Фокус. Открывается ярлыком и из настроек хаба. */
public class SettingsActivity extends Activity {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private Map<String, Object> apk;

    @Override
    protected void onResume() {
        super.onResume();
        render();
        new Thread(() -> {
            Hub hub = LifeHub.get().hub();
            if (hub.paired() && hub.route() != null) {
                try {
                    Map<String, Object> info = Json.obj(Json.parse(hub.call("GET", "/api/app/info", null, null).text()));
                    apk = Json.obj(info.get("apk"));
                } catch (Exception ignored) {
                }
            }
            ui.post(this::render);
        }).start();
    }

    private boolean guardOn() {
        String list = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return list != null && list.contains(getPackageName() + "/");
    }

    private static String size(long bytes) {
        if (bytes < 1024 * 1024) return Math.max(1, bytes / 1024) + " КБ";
        return String.format(java.util.Locale.ROOT, "%.1f МБ", bytes / 1048576.0);
    }

    private void render() {
        Ui u = new Ui(this);
        LifeHub app = LifeHub.get();
        Hub hub = app.hub();
        u.text(u.root, "Настройки", 30, Ui.FG, true, 20);

        // Хаб и офлайн.
        LinearLayout c = u.card(u.root);
        u.text(c, "Хаб", 13, Ui.MUTED, false, 6);
        if (!hub.paired()) {
            u.text(c, "Не подключён — откройте LifeHub, там инструкция.", 15, Ui.FG, false, 0);
        } else {
            Boolean on = hub.isOnline();
            String route = hub.currentRoute();
            String via = "";
            if (route != null) for (Object o : hub.bases()) {
                Map<String, Object> b = Json.obj(o);
                if (route.startsWith(Json.str(b.get("url"), "?"))) via = Json.str(b.get("label"), "");
            }
            u.text(c, on == null ? "Проверяю связь…" : on ? "На связи" + (via.isEmpty() ? "" : " · " + via) : "Без связи — работаю с сохранённым", 17, on != null && on ? Ui.ACCENT : Ui.FG, true, 4);
            int queued = app.proxy().queued();
            u.text(c, "Сохранено для офлайна: " + size(app.proxy().cacheBytes())
                    + (queued > 0 ? "\nЖдут отправки в хаб: " + queued : ""), 14, Ui.MUTED, false, 10);
            u.button(c, "Сохранить всё для офлайна сейчас", false, v -> {
                Background.runNow(this);
                Toast.makeText(this, "Сохраняю — пара минут в фоне", Toast.LENGTH_SHORT).show();
            });
            u.button(c, "Отключить от хаба", false, v -> {
                hub.forget();
                startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
                finish();
            });
        }

        // Обновление.
        if (apk != null && Json.num(apk.get("versionCode"), 0) > BuildInfo.CODE) {
            LinearLayout up = u.card(u.root);
            u.text(up, "Есть новая версия " + Json.str(apk.get("versionName"), ""), 17, Ui.ACCENT, true, 6);
            u.text(up, "Сейчас " + BuildInfo.VERSION + ". Скачается с компьютера, телефон попросит подтвердить установку.", 14, Ui.MUTED, false, 10);
            u.button(up, "Обновить", true, v -> update());
        }

        // Фокус.
        LinearLayout f = u.card(u.root);
        u.text(f, "Фокус", 13, Ui.MUTED, false, 6);
        if (guardOn()) {
            u.text(f, "✅ YouTube и Инста — только с целью и таймером", 16, Ui.ACCENT, true, 4);
            u.text(f, "В приложениях и в браузере. Работает и без связи.", 14, Ui.MUTED, false, 8);
        } else {
            u.text(f, "Выключен", 17, Ui.WARN, true, 6);
            u.text(f, "Включите «LifeHub» в спецвозможностях: Установленные приложения → LifeHub → Вкл.\n\n"
                    + "Переключатель серый? «О приложении» ниже → ⋮ справа сверху → «Разрешить ограниченные настройки» — и снова.", 14, Ui.MUTED, false, 10);
            u.button(f, "Открыть спецвозможности", true, v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
            u.button(f, "О приложении", false,
                    v -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        }
        Store st = Store.get(this);
        JSONObject sessions = st.sessions();
        long now = System.currentTimeMillis();
        for (Iterator<String> it = sessions.keys(); it.hasNext(); ) {
            final String site = it.next();
            JSONObject s = sessions.optJSONObject(site);
            if (s == null || s.optLong("endsAt") <= now) continue;
            u.text(f, s.optString("siteName") + " — ещё " + ((s.optLong("endsAt") - now) / 60_000 + 1) + " мин: «" + s.optString("purpose") + "»", 15, Ui.FG, false, 4);
            u.button(f, "Я всё", false, v -> {
                st.end(site, "self", System.currentTimeMillis());
                Sync.soon(this, 0);
                render();
            });
        }
        JSONArray sites = st.config().optJSONArray("sites");
        StringBuilder today = new StringBuilder();
        if (sites != null) for (int i = 0; i < sites.length(); i++) {
            JSONObject s = sites.optJSONObject(i);
            if (s == null || !s.optBoolean("on")) continue;
            int[] t = st.today(s.optString("id"));
            int limit = s.optInt("dailyMin");
            today.append(s.optString("name")).append(": ").append(t[0]).append(" мин").append(limit > 0 ? " из " + limit : "").append('\n');
        }
        if (today.length() > 0) u.text(f, "Сегодня\n" + today.toString().trim(), 14, Ui.MUTED, false, 0);

        LinearLayout more = u.card(u.root);
        u.text(more, "Ещё", 13, Ui.MUTED, false, 6);
        u.text(more, "• Виджет LifeHub — долгое нажатие на рабочем столе → Виджеты.\n"
                + "• Джарвис голосом — плитка в шторке (✏️ в быстрых настройках) или долгое нажатие на иконку.\n"
                + "• «Поделиться» → LifeHub — ссылка или текст уходит в хаб.\n"
                + "Версия " + BuildInfo.VERSION, 14, Ui.MUTED, false, 0);
    }

    /* ───────────── обновление ───────────── */

    private void update() {
        Toast.makeText(this, "Скачиваю…", Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            try {
                Hub.Response r = LifeHub.get().hub().call("GET", "/api/app/apk", null, null);
                if (r.status != 200) throw new Exception("Хаб ответил " + r.status);
                PackageInstaller pi = getPackageManager().getPackageInstaller();
                int id = pi.createSession(new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL));
                try (PackageInstaller.Session s = pi.openSession(id)) {
                    try (OutputStream o = s.openWrite("lifehub", 0, r.body.length)) {
                        o.write(r.body);
                        s.fsync(o);
                    }
                    Intent cb = new Intent(this, Installed.class);
                    s.commit(PendingIntent.getBroadcast(this, 0, cb, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE).getIntentSender());
                }
            } catch (Exception e) {
                ui.post(() -> Toast.makeText(this, "Не вышло: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }).start();
    }

    /** Ответ установщика: попросить подтверждение у человека. */
    public static class Installed extends BroadcastReceiver {
        @Override
        public void onReceive(Context ctx, Intent i) {
            int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirm != null) ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } else if (status != PackageInstaller.STATUS_SUCCESS) {
                Toast.makeText(ctx, "Не установилось: " + i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE), Toast.LENGTH_LONG).show();
            }
        }
    }
}
