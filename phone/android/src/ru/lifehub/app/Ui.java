package ru.lifehub.app;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Вёрстка кодом — те же цвета, что у экрана входа в расширении браузера (gate.css). */
final class Ui {
    static final int BG = 0xFF0D1117;
    static final int CARD = 0xFF151B24;
    static final int LINE = 0xFF263041;
    static final int FG = 0xFFE8EEF6;
    static final int MUTED = 0xFF8A99AD;
    static final int ACCENT = 0xFF7DD3A8;
    static final int WARN = 0xFFF2B45C;
    static final int DANGER = 0xFFF07178;

    final Activity a;
    final LinearLayout root;

    Ui(Activity a) {
        this.a = a;
        a.getWindow().setStatusBarColor(BG);
        a.getWindow().setNavigationBarColor(BG);
        ScrollView scroll = new ScrollView(a);
        scroll.setBackgroundColor(BG);
        scroll.setFillViewport(true);
        root = new LinearLayout(a);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(48), dp(20), dp(32));
        scroll.addView(root, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        a.setContentView(scroll);
    }

    int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, a.getResources().getDisplayMetrics());
    }

    static GradientDrawable box(int fill, int stroke, float radiusPx, int strokePx) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(radiusPx);
        if (stroke != 0) g.setStroke(strokePx, stroke);
        return g;
    }

    TextView text(LinearLayout parent, String s, float sp, int color, boolean bold, int marginBottomDp) {
        TextView t = new TextView(a);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setLineSpacing(0, 1.15f);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(marginBottomDp);
        parent.addView(t, lp);
        return t;
    }

    EditText input(LinearLayout parent, String hint) {
        EditText e = new EditText(a);
        e.setHint(hint);
        e.setHintTextColor(MUTED);
        e.setTextColor(FG);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        e.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        e.setPadding(dp(14), dp(12), dp(14), dp(12));
        e.setBackground(box(CARD, LINE, dp(12), dp(1)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(8);
        parent.addView(e, lp);
        return e;
    }

    /** Крупная кнопка: primary — зелёная, иначе — прозрачная приглушённая. */
    Button button(LinearLayout parent, String s, boolean primary, View.OnClickListener l) {
        Button b = new Button(a);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, primary ? 17 : 15);
        b.setTextColor(primary ? 0xFF0B1A12 : MUTED);
        b.setStateListAnimator(null);
        b.setBackground(primary ? box(ACCENT, 0, dp(12), 0) : box(Color.TRANSPARENT, 0, dp(12), 0));
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(primary ? 54 : 46));
        lp.topMargin = dp(primary ? 0 : 4);
        parent.addView(b, lp);
        return b;
    }

    static void setPrimaryEnabled(Button b, boolean on, Ui ui) {
        b.setEnabled(on);
        b.setTextColor(on ? 0xFF0B1A12 : MUTED);
        b.setBackground(box(on ? ACCENT : CARD, 0, ui.dp(12), 0));
    }

    /** Ряд «пилюль» (варианты минут). */
    LinearLayout chipsRow(LinearLayout parent) {
        LinearLayout row = new LinearLayout(a);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.START);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(24);
        parent.addView(row, lp);
        return row;
    }

    Button chip(LinearLayout row, String s, View.OnClickListener l) {
        Button b = new Button(a);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(FG);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setStateListAnimator(null);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setPadding(dp(12), 0, dp(12), 0);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(44), 1);
        lp.rightMargin = dp(8);
        row.addView(b, lp);
        return b;
    }

    void chipState(Button b, boolean on) {
        b.setBackground(box(on ? 0x297DD3A8 : Color.TRANSPARENT, on ? ACCENT : LINE, dp(22), dp(1)));
    }

    LinearLayout card(LinearLayout parent) {
        LinearLayout c = new LinearLayout(a);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setPadding(dp(16), dp(14), dp(16), dp(14));
        c.setBackground(box(CARD, LINE, dp(14), dp(1)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(16);
        parent.addView(c, lp);
        return c;
    }

    static String plural(int n, String one, String few, String many) {
        int a = Math.abs(n) % 100;
        int b = a % 10;
        if (a > 10 && a < 20) return many;
        if (b == 1) return one;
        if (b > 1 && b < 5) return few;
        return many;
    }
}
