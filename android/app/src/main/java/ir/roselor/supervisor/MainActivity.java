package ir.roselor.supervisor;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.view.View;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.JavascriptInterface;
import android.graphics.Color;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4107;
    private static final String CHANNEL_ID = "roselor_general";
    private WebView web;
    private LinearLayout root;
    private View errorView;
    private static final String PORTAL_URL = "https://alitoorabi-maker.github.io/roselor-accounting/supervisor-portal.html";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(6,26,18));
        getWindow().setNavigationBarColor(Color.rgb(6,26,18));
        createNotificationChannel();
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(6,26,18));
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
        web.getSettings().setSafeBrowsingEnabled(true);
        web.getSettings().setLoadsImagesAutomatically(true);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.addJavascriptInterface(new AndroidNotificationBridge(), "RoselorAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                hideError();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) showError();
            }
            @SuppressWarnings("deprecation")
            @Override public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (Build.VERSION.SDK_INT < 23) showError();
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        root.addView(web, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT
        ));
        setContentView(root);
        web.loadUrl(PORTAL_URL);
    }

    private void showError() {
        runOnUiThread(() -> {
            if (root == null || errorView != null) return;
            LinearLayout panel = new LinearLayout(this);
            panel.setOrientation(LinearLayout.VERTICAL); panel.setGravity(Gravity.CENTER); panel.setPadding(36,36,36,36); panel.setBackgroundColor(Color.rgb(6,26,18));
            TextView title = new TextView(this); title.setText("اتصال به رز لر برقرار نشد"); title.setTextColor(Color.rgb(241,220,163)); title.setTextSize(20); title.setGravity(Gravity.CENTER);
            TextView detail = new TextView(this); detail.setText("اتصال اینترنت یا دسترسی به سرور را بررسی کن و دوباره تلاش کن."); detail.setTextColor(Color.WHITE); detail.setTextSize(14); detail.setGravity(Gravity.CENTER);
            Button retry = new Button(this); retry.setText("تلاش دوباره"); retry.setOnClickListener(v -> { hideError(); web.loadUrl(PORTAL_URL); });
            panel.addView(title); panel.addView(detail); panel.addView(retry); errorView = panel;
            root.addView(errorView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
        });
    }
    private void hideError() {
        runOnUiThread(() -> { if (root != null && errorView != null) { root.removeView(errorView); errorView = null; } });
    }
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "اعلان‌های رز لر", NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("اعلان‌های برنامه رز لر");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private class AndroidNotificationBridge {
        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 33 ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    dispatchNotificationPermission(true);
                    return;
                }
                requestPermissions(
                    new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    NOTIFICATION_PERMISSION_REQUEST
                );
            });
        }
    }

    private void dispatchNotificationPermission(boolean granted) {
        if (web != null) {
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('roselor-notification-permission',{detail:{granted:" + granted + "}}));",
                null
            );
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST && web != null) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            dispatchNotificationPermission(granted);
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
