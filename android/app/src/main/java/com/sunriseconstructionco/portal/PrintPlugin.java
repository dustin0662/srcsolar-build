package com.sunriseconstructionco.portal;

import android.app.Activity;
import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens the Android system print sheet for an HTML document supplied by the
 * web layer (the Bid Estimator's rendered page). The document is loaded into
 * an offscreen WebView and handed to PrintManager, exactly as the standalone
 * estimator app did with its own WebView; the user then picks "Save as PDF"
 * or a printer. The WebView is kept referenced until the next job so the
 * print adapter can keep reading from it.
 */
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    private WebView printView;

    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html");
        final String name = call.getString("name", "Sunrise Estimate");
        if (html == null || html.isEmpty()) { call.reject("html required"); return; }
        final Activity act = getActivity();
        if (act == null) { call.reject("no activity"); return; }

        act.runOnUiThread(() -> {
            try {
                if (printView != null) { printView.destroy(); printView = null; }
                final WebView wv = new WebView(act);
                wv.getSettings().setJavaScriptEnabled(false);
                wv.getSettings().setLoadWithOverviewMode(true);
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        // give inline data-URI fonts and images a moment to decode
                        view.postDelayed(() -> startJob(act, view, name, call), 300);
                    }
                });
                printView = wv;
                wv.loadDataWithBaseURL("https://localhost/estimator/", html, "text/html", "utf-8", null);
            } catch (Exception e) {
                call.reject("Could not start the print sheet: " + e.getMessage());
            }
        });
    }

    private void startJob(Activity act, WebView view, String name, PluginCall call) {
        PrintManager pm = (PrintManager) act.getSystemService(Context.PRINT_SERVICE);
        if (pm == null) { call.reject("Printing is not available on this device."); return; }
        try {
            PrintAttributes attrs = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.NA_LETTER)
                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .build();
            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(name);
            pm.print(name, adapter, attrs);
            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not start the print sheet: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (printView != null) { printView.destroy(); printView = null; }
        super.handleOnDestroy();
    }
}
