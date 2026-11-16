package ir.roselor.florist;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 5107;
    private static final String CHANNEL_ID = "roselor_florist";
    private static MainActivity active;
    private WebView web;
    private LinearLayout root;
    private View splash;
    private static final String PORTAL_URL = "https://alitoorabi-maker.github.io/roselor-accounting/customer-portal.html";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        active = this;
        getWindow().setStatusBarColor(Color.rgb(6,26,18));
        getWindow().setNavigationBarColor(Color.rgb(6,26,18));
        createNotificationChannel();

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(6,26,18));

        LinearLayout splashLayout = new LinearLayout(this);
        splashLayout.setOrientation(LinearLayout.VERTICAL);
        splashLayout.setGravity(Gravity.CENTER);
        splashLayout.setBackgroundColor(Color.rgb(6,26,18));
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.roselor_logo);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(dp(176), dp(176));
        splashLayout.addView(logo, logoParams);
        TextView brand = new TextView(this);
        brand.setText("رز لر");
        brand.setTextColor(Color.rgb(243,196,91));
        brand.setTextSize(25);
        brand.setGravity(Gravity.CENTER);
        brand.setPadding(0, dp(14), 0, dp(4));
        splashLayout.addView(brand);
        TextView role = new TextView(this);
        role.setText("سامانه گل‌فروش");
        role.setTextColor(Color.rgb(190,205,194));
        role.setTextSize(14);
        role.setGravity(Gravity.CENTER);
        splashLayout.addView(role);
        splash = splashLayout;
        root.addView(splash, new LinearLayout.LayoutParams(-1, -1));

        web = new WebView(this);
        web.setVisibility(View.GONE);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setDatabaseEnabled(true);
        web.getSettings().setSafeBrowsingEnabled(true);
        web.getSettings().setLoadsImagesAutomatically(true);
        web.addJavascriptInterface(new AndroidBridge(), "RoselorAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (splash != null) {
                    root.removeView(splash);
                    splash = null;
                    web.setVisibility(View.VISIBLE);
                }
                String token = getSharedPreferences("roselor_florist", MODE_PRIVATE).getString("fcm_token", "");
                if (token != null && !token.isEmpty()) dispatchToken(token);
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1f));
        TextView version = new TextView(this);
        version.setText("رز لر | گل‌فروش · نسخه 1.0.2");
        version.setTextColor(Color.rgb(151,171,157));
        version.setTextSize(10);
        version.setGravity(Gravity.CENTER);
        version.setPadding(0,3,0,5);
        root.addView(version, new LinearLayout.LayoutParams(-1,-2));
        setContentView(root);
        web.loadUrl(PORTAL_URL);
    }

    private int dp(int value) { return (int)(value * getResources().getDisplayMetrics().density + 0.5f); }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "اعلان‌های گل‌فروش رز لر", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("اعلان ارسال و تحویل بارهای رز لر");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private void dispatchPermission(boolean granted) {
        if (web != null) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('roselor-notification-permission',{detail:{granted:" + granted + "}}));", null);
    }
    private void dispatchToken(String token) {
        if (web != null) {
            String safe = token.replace("\\","\\\\").replace("'","\\'");
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('roselor-fcm-token',{detail:{token:'" + safe + "'}}));", null);
        }
    }
    public static void deliverRefreshedToken(String token) {
        MainActivity a = active;
        if (a != null) a.runOnUiThread(() -> a.dispatchToken(token));
    }

    private class AndroidBridge {
        @JavascriptInterface public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    dispatchPermission(true); return;
                }
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
            });
        }
        @JavascriptInterface public void requestFcmToken() {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    if (web != null) web.post(() -> dispatchToken(""));
                    return;
                }
                String token = task.getResult();
                getSharedPreferences("roselor_florist", MODE_PRIVATE).edit().putString("fcm_token", token).apply();
                if (web != null) web.post(() -> dispatchToken(token));
            });
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_PERMISSION_REQUEST) dispatchPermission(grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED);
    }
    @Override protected void onDestroy() { if (active == this) active = null; super.onDestroy(); }
    @Override public void onBackPressed() { if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
