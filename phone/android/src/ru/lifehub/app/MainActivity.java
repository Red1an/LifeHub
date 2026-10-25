package ru.lifehub.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URLEncoder;

/**
 * Хаб как приложение: WebView на прокси внутри телефона (Proxy), поэтому работает и без связи.
 * Сверху — тонкая полоса «Без связи», когда хаб недоступен. Не подключён — экран подключения.
 */
public class MainActivity extends Activity {
    private static final int REQ_MIC = 1;
    private static final int REQ_FILE = 2;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView banner;
    /** Подложки под строкой состояния и полосой жестов — цвета краёв страницы (см. bars). */
    private View topStrip, bottomStrip;
    private int insetTop, insetBottom, insetIme;
    /**
     * Страница сама отступает от полос через env(safe-area-inset-*) (WebView это умеет не везде — сообщает appBars.ts).
     * Тогда WebView во весь экран и полосы прозрачны прямо над страницей; иначе — отступы и подложки здесь.
     */
    private boolean pageInsets = true;
    private long pausedAt;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingFiles;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(0xFF121211);
        getWindow().setNavigationBarColor(0xFF121211);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 0);
        }
        if (!handlePair(getIntent())) show(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (!handlePair(i)) show(i);
    }

    /* ───────────── подключение ───────────── */

    /** lifehub://pair?code=…&base=… — со страницы по QR-коду из настроек хаба. */
    private boolean handlePair(Intent i) {
        Uri data = i.getData();
        if (data == null || !"lifehub".equals(data.getScheme()) || !"pair".equals(data.getHost())) return false;
        String code = data.getQueryParameter("code");
        String base = data.getQueryParameter("base");
        if (code == null || base == null) return false;
        pair(base, code);
        return true;
    }

    /** То же по ссылке целиком: https://…/hook/app/pair/<код>. */
    private void pairByLink(String link) {
        int at = link.indexOf("/hook/app/pair/");
        if (at < 0) {
            Toast.makeText(this, "Нужна ссылка из настроек хаба: …/hook/app/pair/…", Toast.LENGTH_LONG).show();
            return;
        }
        String code = link.substring(at + "/hook/app/pair/".length()).replaceAll("[/?#].*$", "");
        pair(link.substring(0, at), code);
    }

    private void pair(String base, String code) {
        Toast.makeText(this, "Подключаюсь к хабу…", Toast.LENGTH_SHORT).show();
        String name = Build.MANUFACTURER + " " + Build.MODEL;
        new Thread(() -> {
            try {
                LifeHub.get().hub().claim(base, code, name.trim());
                ui.post(() -> {
                    Toast.makeText(this, "Готово — хаб подключён", Toast.LENGTH_SHORT).show();
                    Background.runNow(this);
                    show(new Intent());
                });
            } catch (Exception e) {
                ui.post(() -> {
                    Toast.makeText(this, "Не вышло: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    show(new Intent());
                });
            }
        }).start();
    }

    private void setup() {
        web = null;
        Ui u = new Ui(this);
        u.text(u.root, "LifeHub", 32, Ui.FG, true, 6);
        u.text(u.root, "Хаб с компьютера — как приложение, и без связи тоже.", 15, Ui.MUTED, false, 24);
        android.widget.LinearLayout c = u.card(u.root);
        u.text(c, "Как подключить", 17, Ui.FG, true, 8);
        u.text(c, "1. На компьютере откройте хаб → Настройки → «Приложение на телефоне» → «Подключить телефон».\n"
                + "2. Наведите камеру на QR-код и нажмите «Открыть в приложении».\n\n"
                + "Или скопируйте ссылку под QR-кодом и вставьте сюда:", 15, Ui.MUTED, false, 12);
        EditText link = u.input(c, "https://…/hook/app/pair/…");
        u.button(c, "Подключить", true, v -> pairByLink(link.getText().toString().trim()));
    }

    /* ───────────── хаб ───────────── */

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void show(Intent i) {
        Hub hub = LifeHub.get().hub();
        if (!hub.paired()) {
            setup();
            return;
        }
        String path = target(i);
        if (web != null) {
            if (path != null) web.loadUrl(LifeHub.get().local() + path);
            return;
        }
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF121211);
        edgeToEdge(root);
        // Отладка страницы с компьютера по USB (chrome://inspect) — приложение личное, отладка и так нужна для adb.
        WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        // Как приложение, а не сайт: без щипкового зума, без «растяжения» за краем, шрифт как задумано.
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " LifeHubApp/" + BuildInfo.VERSION);
        web.setBackgroundColor(0xFF121211);
        web.addJavascriptInterface(new Bridge(), "LifeHubApp");
        final Fonts fonts = new Fonts(this);
        final String agent = s.getUserAgentString();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return Fonts.handles(r.getUrl().getHost()) ? fonts.get(r.getUrl().toString(), agent) : null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                // Чужие сайты, tel:, mailto:, intent: — во внешних приложениях.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception ignored) {
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest r) {
                // Микрофон — тюнер и тренажёры «Гитары», голос Джарвиса.
                for (String res : r.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) r.grant(new String[]{res});
                        else {
                            pendingMic = r;
                            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                        }
                        return;
                    }
                }
                r.deny();
            }

            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = cb;
                try {
                    startActivityForResult(p.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Exception ignored) {
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        topStrip = new View(this);
        topStrip.setBackgroundColor(0xFF121211);
        root.addView(topStrip, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.TOP));
        bottomStrip = new View(this);
        bottomStrip.setBackgroundColor(0xFF1A1A19);
        root.addView(bottomStrip, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, Gravity.BOTTOM));

        banner = new TextView(this);
        banner.setTextSize(13);
        banner.setGravity(Gravity.CENTER_VERTICAL);
        banner.setCompoundDrawablePadding(dp(8));
        banner.setPadding(dp(14), dp(8), dp(16), dp(8));
        banner.setElevation(dp(6));
        banner.setVisibility(View.GONE);
        banner.setOnClickListener(v -> {
            banner.setText("Проверяю связь…");
            hub.wake();
            new Thread(() -> {
                if (hub.route() == null) ui.post(this::offlineText);
            }).start();
        });
        root.addView(banner, bannerPlace());
        setContentView(root);
        paintBanner(false);
        offlineText();

        hub.setListener(on -> ui.post(() -> showBanner(!on)));
        Boolean on = hub.isOnline();
        if (on != null && !on) showBanner(true);
        web.loadUrl(LifeHub.get().local() + (path != null ? path : "/"));
    }

    /* ───────────── плашка «Без связи» и системные полосы ───────────── */

    /** Высота нижнего меню страницы (dp) — плашка висит над ним. */
    private int pageBar;
    private boolean lightPage;

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private FrameLayout.LayoutParams bannerPlace() {
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        lp.bottomMargin = Math.max(insetBottom, insetIme) + dp(pageBar + 12);
        return lp;
    }

    /**
     * Окно рисуется под строкой состояния и полосой жестов, сами полосы прозрачные. Страница стоит между ними
     * (её вёрстка не меняется), а под полосами — подложки цвета её краёв: полоса жестов выглядит частью интерфейса.
     * Свои отступы, а не env(safe-area-inset-*) в странице: WebView отдаёт их не везде, а модули на них рассчитывают.
     */
    @SuppressWarnings("deprecation")
    private void edgeToEdge(FrameLayout root) {
        android.view.Window w = getWindow();
        w.setStatusBarColor(android.graphics.Color.TRANSPARENT);
        w.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 28) w.setNavigationBarDividerColor(android.graphics.Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            w.setNavigationBarContrastEnforced(false);
            w.setStatusBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        else w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
        root.setOnApplyWindowInsetsListener((v, in) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = in.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                insetTop = bars.top;
                insetBottom = bars.bottom;
                // Клавиатура: при рисовании под полосами adjustResize не работает — поднимаем страницу сами.
                insetIme = in.getInsets(android.view.WindowInsets.Type.ime()).bottom;
            } else {
                insetTop = in.getSystemWindowInsetTop();
                insetBottom = in.getSystemWindowInsetBottom();
                insetIme = 0;
            }
            applyInsets();
            return in;
        });
    }

    private void applyInsets() {
        int top = pageInsets ? 0 : insetTop;
        int bottom = pageInsets ? insetIme : Math.max(insetBottom, insetIme);
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
        if (lp.topMargin != top || lp.bottomMargin != bottom) {
            lp.topMargin = top;
            lp.bottomMargin = bottom;
            web.setLayoutParams(lp);
        }
        topStrip.getLayoutParams().height = top;
        topStrip.requestLayout();
        bottomStrip.getLayoutParams().height = bottom;
        bottomStrip.requestLayout();
        banner.setLayoutParams(bannerPlace());
    }

    private void offlineText() {
        banner.setText("Нет связи с компьютером · сохранённое");
    }

    private void showBanner(boolean show) {
        if (show == (banner.getVisibility() == View.VISIBLE)) return;
        if (show) {
            offlineText();
            banner.setAlpha(0f);
            banner.setTranslationY(dp(8));
            banner.setVisibility(View.VISIBLE);
            banner.animate().alpha(1f).translationY(0).setDuration(180).start();
        } else {
            banner.animate().alpha(0f).translationY(dp(8)).setDuration(150).withEndAction(() -> banner.setVisibility(View.GONE)).start();
        }
    }

    /** Пилюля в цветах хаба (surface-2, line, fg из platform/styles.css) с красной точкой слева. */
    private void paintBanner(boolean light) {
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setCornerRadius(dp(999));
        bg.setColor(light ? 0xF2FFFFFF : 0xF2232321);
        bg.setStroke(Math.max(1, dp(1) / 2), light ? 0xFFE4E4E0 : 0xFF34342F);
        banner.setBackground(bg);
        banner.setTextColor(light ? 0xFF1A1A18 : 0xFFE9E9E4);
        android.graphics.drawable.GradientDrawable dot = new android.graphics.drawable.GradientDrawable();
        dot.setShape(android.graphics.drawable.GradientDrawable.OVAL);
        dot.setColor(light ? 0xFFC2352B : 0xFFE0675D);
        dot.setSize(dp(7), dp(7));
        banner.setCompoundDrawablesRelativeWithIntrinsicBounds(dot, null, null, null);
    }

    /** Страница сообщила цвета у верхнего и нижнего края — системные полосы сливаются с ней. */
    @SuppressWarnings("deprecation")
    private void bars(int top, int bottom, boolean light, int bar) {
        topStrip.setBackgroundColor(top);
        bottomStrip.setBackgroundColor(bottom);
        // Светлая страница — тёмные значки и полоса жестов, тёмная — светлые.
        android.view.Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            int mask = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            android.view.WindowInsetsController c = w.getInsetsController();
            if (c != null) c.setSystemBarsAppearance(light ? mask : 0, mask);
        } else {
            int flags = w.getDecorView().getSystemUiVisibility();
            int lightFlags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            w.getDecorView().setSystemUiVisibility(light ? flags | lightFlags : flags & ~lightFlags);
        }
        if (light != lightPage) {
            lightPage = light;
            paintBanner(light);
        }
        if (bar != pageBar) {
            pageBar = bar;
            banner.setLayoutParams(bannerPlace());
        }
    }

    private static int color(String hex, int fallback) {
        try {
            return 0xFF000000 | Integer.parseInt(hex.replace("#", ""), 16);
        } catch (Exception e) {
            return fallback;
        }
    }

    /** Куда открыть: из виджета/уведомления (extra path), «Поделиться» (/share) или главная. */
    private String target(Intent i) {
        if (Intent.ACTION_SEND.equals(i.getAction())) {
            String text = i.getStringExtra(Intent.EXTRA_TEXT);
            String title = i.getStringExtra(Intent.EXTRA_SUBJECT);
            try {
                return "/share?text=" + URLEncoder.encode(text == null ? "" : text, "UTF-8")
                        + (title != null ? "&title=" + URLEncoder.encode(title, "UTF-8") : "");
            } catch (Exception e) {
                return "/share";
            }
        }
        String path = i.getStringExtra("path");
        return path != null && path.startsWith("/") ? path : null;
    }

    /** Связь страницы хаба с телефоном (window.LifeHubApp). */
    private final class Bridge {
        /** Главная хаба прислала сводки модулей — для виджета на рабочем столе. */
        @JavascriptInterface
        public void summaries(String json) {
            Widgets.save(MainActivity.this, json);
        }

        /** platform/shell/appBars.ts: цвета краёв страницы и высота её нижнего меню. */
        @JavascriptInterface
        public void bars(String top, String bottom, boolean light, int bar) {
            ui.post(() -> MainActivity.this.bars(color(top, 0xFF121211), color(bottom, 0xFF121211), light, Math.max(0, bar)));
        }

        /** platform/shell/appBars.ts: какие отступы от полос страница сделала сама (CSS px; 0 — WebView их не знает). */
        @JavascriptInterface
        public void insets(int top, int bottom) {
            ui.post(() -> {
                boolean own = insetTop == 0 || top > 0;
                if (own != pageInsets) {
                    pageInsets = own;
                    applyInsets();
                }
            });
        }

        @JavascriptInterface
        public void openSettings() {
            ui.post(() -> startActivity(new Intent(MainActivity.this, SettingsActivity.class)));
        }

        @JavascriptInterface
        public String version() {
            return BuildInfo.VERSION;
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        if (code == REQ_MIC && pendingMic != null) {
            if (res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) pendingMic.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else pendingMic.deny();
            pendingMic = null;
        }
    }

    @Override
    protected void onActivityResult(int code, int result, Intent data) {
        if (code == REQ_FILE && pendingFiles != null) {
            pendingFiles.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            pendingFiles = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            // После долгого фона связь могла пропасть: пока хаб не ответит, страница работает с сохранённым, а не ждёт.
            Hub hub = LifeHub.get().hub();
            if (pausedAt > 0 && System.currentTimeMillis() - pausedAt > 30_000) hub.wake();
            hub.probeSoon();
        }
    }

    @Override
    protected void onPause() {
        pausedAt = System.currentTimeMillis();
        if (web != null) web.onPause();
        super.onPause();
    }
}
