package ru.lifehub.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;

/**
 * Следит, что на экране (спецвозможности):
 *  - какое приложение открыто — по смене окна;
 *  - в браузерах — адрес из адресной строки (только её, остальное содержимое не читаем).
 * Открыли YouTube/Инсту (приложение или сайт) без сеанса → экран «Зачем пришёл?» (GateActivity).
 * Время сеанса вышло → на рабочий стол и итог. Ушёл с сайта дольше чем на минуту → сеанс закончен.
 */
public class GuardService extends AccessibilityService {
    /** id адресной строки у известных браузеров (после «пакет:id/»). */
    private static final String[] URL_IDS = {
            "url_bar", "url_field", "mozac_browser_toolbar_url_view", "location_bar_edit_text",
            "omnibarTextInput", "bro_omnibar_address_title_text", "address_bar_edit_text",
    };
    /** Если id неизвестен — ищем поле, в id которого есть одно из этих слов. */
    private static final String[] URL_HINTS = {"url", "address", "omnibar", "location_bar"};

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Set<String> ignored = new HashSet<>();
    private final Set<String> browsers = new HashSet<>();
    /** Приложение на экране (без клавиатур и системной шторки). */
    private String current = "";
    /** Сайт на экране: приложение YouTube/Инсты или их адрес в браузере; null — ни то ни другое. */
    private String currentSite = null;
    private long gateShownAt = 0;
    private String gateShownFor = "";
    private long urlCheckedAt = 0;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (browsers.contains(current)) browserChanged(true);
            check();
            handler.postDelayed(this, 5000);
        }
    };

    @Override
    protected void onServiceConnected() {
        ignored.add(getPackageName());
        ignored.add("com.android.systemui");
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (imm != null) for (InputMethodInfo i : imm.getInputMethodList()) ignored.add(i.getPackageName());
        // Браузеры — все, кто открывает http-ссылки.
        Intent web = new Intent(Intent.ACTION_VIEW, Uri.parse("http://example.com"));
        for (ResolveInfo r : getPackageManager().queryIntentActivities(web, PackageManager.MATCH_ALL)) browsers.add(r.activityInfo.packageName);
        handler.post(tick);
        Sync.soon(this, 0);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        if (e.getPackageName() == null) return;
        String pkg = e.getPackageName().toString();
        int type = e.getEventType();
        if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            // Переход на другой адрес в браузере — это изменение содержимого, не смена окна.
            if (pkg.equals(current) && browsers.contains(pkg)) browserChanged(false);
            return;
        }
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        if (pkg.equals(getPackageName())) {
            current = pkg;
            currentSite = null;
            return;
        }
        if (ignored.contains(pkg)) return;
        current = pkg;
        String site = Store.get(this).siteForPackage(pkg);
        if (site == null && browsers.contains(pkg)) site = browserSite(pkg);
        currentSite = site;
        if (site != null) guard(site, pkg);
        check();
        Sync.soon(this, 10 * 60_000);
    }

    /** Адрес в браузере мог смениться — не чаще раза в 0,7 с (страница присылает событие на каждую перерисовку). */
    private void browserChanged(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - urlCheckedAt < 700) return;
        urlCheckedAt = now;
        String site = browserSite(current);
        if (site == null ? currentSite == null : site.equals(currentSite)) return;
        currentSite = site;
        if (site != null) guard(site, current);
        check();
    }

    /** Сайт из адресной строки браузера на экране. Пока строку редактируют — прежний сайт. */
    private String browserSite(String pkg) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || root.getPackageName() == null || !pkg.equals(root.getPackageName().toString())) return currentSite;
        AccessibilityNodeInfo bar = urlBar(root, pkg);
        if (bar == null) return null;
        if (bar.isFocused()) return currentSite;
        CharSequence text = bar.getText();
        return text == null ? null : Store.get(this).siteForUrl(text.toString());
    }

    private AccessibilityNodeInfo urlBar(AccessibilityNodeInfo root, String pkg) {
        for (String id : URL_IDS) {
            List<AccessibilityNodeInfo> found = root.findAccessibilityNodeInfosByViewId(pkg + ":id/" + id);
            if (found != null) for (AccessibilityNodeInfo n : found) if (n != null && n.getText() != null) return n;
        }
        ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>();
        queue.add(root);
        for (int seen = 0; !queue.isEmpty() && seen < 300; seen++) {
            AccessibilityNodeInfo n = queue.poll();
            String id = n.getViewIdResourceName();
            if (id != null && n.getText() != null) {
                String low = id.toLowerCase();
                for (String h : URL_HINTS) if (low.contains(h)) return n;
            }
            for (int i = 0; i < n.getChildCount(); i++) {
                AccessibilityNodeInfo c = n.getChild(i);
                if (c != null) queue.add(c);
            }
        }
        return null;
    }

    /** Сайт на экране: нет сеанса — экран входа, время вышло — закончить. */
    private void guard(String site, String pkg) {
        Store st = Store.get(this);
        if (!st.guarded(site)) return;
        JSONObject s = st.session(site);
        if (s == null) showGate(site, pkg);
    }

    private void showGate(String site, String pkg) {
        long now = System.currentTimeMillis();
        // Одно открытие присылает несколько событий — экран входа показываем один раз.
        if (site.equals(gateShownFor) && now - gateShownAt < 1500) return;
        gateShownFor = site;
        gateShownAt = now;
        Intent i = new Intent(this, GateActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("site", site)
                .putExtra("pkg", pkg);
        startActivity(i);
    }

    /** Время вышло → закончить и выгнать; сайта нет на экране дольше минуты → сеанс закончен. */
    private void check() {
        Store st = Store.get(this);
        JSONObject all = st.sessions();
        long now = System.currentTimeMillis();
        for (Iterator<String> it = all.keys(); it.hasNext(); ) {
            String site = it.next();
            JSONObject s = all.optJSONObject(site);
            if (s == null) continue;
            boolean onScreen = site.equals(currentSite);
            if (s.optLong("endsAt") <= now) {
                st.end(site, "timer", s.optLong("endsAt"));
                if (onScreen) {
                    performGlobalAction(GLOBAL_ACTION_HOME);
                    startActivity(new Intent(this, GateActivity.class)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                            .putExtra("site", site)
                            .putExtra("done", true));
                }
                Sync.soon(this, 0);
            } else if (onScreen) {
                st.markGone(site, 0);
            } else if (!s.has("goneAt")) {
                st.markGone(site, now);
            } else if (now - s.optLong("goneAt") >= Store.GRACE_MS) {
                st.end(site, "closed", s.optLong("goneAt"));
                Sync.soon(this, 0);
            }
        }
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        super.onDestroy();
    }
}
