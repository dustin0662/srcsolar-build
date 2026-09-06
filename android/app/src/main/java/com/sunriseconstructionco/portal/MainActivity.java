package com.sunriseconstructionco.portal;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Android 15+ draws the app edge-to-edge and (from target SDK 36) no longer
 * lets a theme opt out, so the WebView ended up underneath the status bar
 * and the navigation bar. Instead of every screen padding itself, the
 * WebView is given margins equal to the system-bar insets here — the web
 * content then always starts below the clock and ends above the nav bar,
 * and the keyboard (IME inset) pushes it up the same way.
 */
public class MainActivity extends BridgeActivity {

    private static final int BAR_BG = Color.parseColor("#05070f");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final View web = getBridge().getWebView();
        final View decor = getWindow().getDecorView();
        decor.setBackgroundColor(BAR_BG);
        View parent = (View) web.getParent();
        if (parent != null) parent.setBackgroundColor(BAR_BG);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat ctl = WindowCompat.getInsetsController(getWindow(), decor);
        ctl.setAppearanceLightStatusBars(false);
        ctl.setAppearanceLightNavigationBars(false);

        ViewCompat.setOnApplyWindowInsetsListener(web, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            int bottom = Math.max(bars.bottom, ime.bottom);
            ViewGroup.LayoutParams lp = v.getLayoutParams();
            if (lp instanceof ViewGroup.MarginLayoutParams) {
                ViewGroup.MarginLayoutParams mlp = (ViewGroup.MarginLayoutParams) lp;
                if (mlp.topMargin != bars.top || mlp.bottomMargin != bottom || mlp.leftMargin != bars.left || mlp.rightMargin != bars.right) {
                    mlp.setMargins(bars.left, bars.top, bars.right, bottom);
                    v.setLayoutParams(mlp);
                }
            }
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(web);
    }
}
