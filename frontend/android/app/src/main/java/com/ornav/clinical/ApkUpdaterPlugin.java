package com.ornav.clinical;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {
    private static final String TAG = "ApkUpdater";

    @PluginMethod
    public void installApk(PluginCall call) {
        String apkUrl = call.getString("url");
        if (apkUrl == null || apkUrl.trim().isEmpty()) {
            call.reject("Must provide valid APK download URL");
            return;
        }

        final String cleanUrl = apkUrl.trim();
        final Context context = getContext();
        final Activity activity = getActivity();

        if (context == null || activity == null) {
            call.reject("Android Context or Activity unavailable");
            return;
        }

        // Check for Android 8.0+ Unknown App Sources Permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (!context.getPackageManager().canRequestPackageInstalls()) {
                Log.w(TAG, "REQUEST_INSTALL_PACKAGES not granted. Redirecting to settings.");
                Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                settingsIntent.setData(Uri.parse("package:" + context.getPackageName()));
                settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(settingsIntent);
                call.reject("Permission required: Please enable 'Allow from this source' for OR-Nav, then tap update again.");
                return;
            }
        }

        // Download and launch installer on background thread
        new Thread(() -> {
            HttpURLConnection conn = null;
            InputStream in = null;
            FileOutputStream out = null;
            try {
                Log.i(TAG, "Downloading APK from: " + cleanUrl);
                URL currentUrl = new URL(cleanUrl);
                int statusCode = 0;
                int redirects = 0;

                while (redirects < 5) {
                    conn = (HttpURLConnection) currentUrl.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setRequestMethod("GET");
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "OR-Nav-Android-OTA");
                    conn.setRequestProperty("Cache-Control", "no-cache");
                    conn.connect();

                    statusCode = conn.getResponseCode();
                    Log.i(TAG, "HTTP " + statusCode + " from " + currentUrl.toString());

                    // Follow HTTP 301, 302, 303, 307, 308 (GitHub releases redirect to AWS S3 objects.githubusercontent.com)
                    if (statusCode == HttpURLConnection.HTTP_MOVED_PERM ||
                        statusCode == HttpURLConnection.HTTP_MOVED_TEMP ||
                        statusCode == HttpURLConnection.HTTP_SEE_OTHER ||
                        statusCode == 307 || statusCode == 308) {
                        String location = conn.getHeaderField("Location");
                        if (location != null && !location.isEmpty()) {
                            Log.i(TAG, "Following redirect to: " + location);
                            currentUrl = new URL(location);
                            conn.disconnect();
                            redirects++;
                            continue;
                        }
                    }
                    break;
                }

                if (statusCode != HttpURLConnection.HTTP_OK) {
                    call.reject("Server returned HTTP " + statusCode + ": " + (conn != null ? conn.getResponseMessage() : "Unknown error"));
                    return;
                }

                File downloadDir = context.getExternalFilesDir(null);
                if (downloadDir == null) {
                    downloadDir = context.getCacheDir();
                }
                File apkFile = new File(downloadDir, "or-nav-update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                in = conn.getInputStream();
                out = new FileOutputStream(apkFile);
                byte[] buffer = new byte[16384];
                int bytesRead;
                long totalBytes = 0;
                while ((bytesRead = in.read(buffer)) != -1) {
                    out.write(buffer, 0, bytesRead);
                    totalBytes += bytesRead;
                }
                out.flush();
                Log.i(TAG, "APK download complete. Total bytes: " + totalBytes + " saved to: " + apkFile.getAbsolutePath());

                // Generate FileProvider Content URI
                Uri apkUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    apkFile
                );

                // Build install Intent
                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                installIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);

                activity.runOnUiThread(() -> {
                    try {
                        context.startActivity(installIntent);
                        JSObject res = new JSObject();
                        res.put("success", true);
                        res.put("path", apkFile.getAbsolutePath());
                        res.put("bytes", totalBytes);
                        call.resolve(res);
                    } catch (Exception launchErr) {
                        Log.e(TAG, "Failed to launch package installer intent", launchErr);
                        call.reject("Could not launch package installer: " + launchErr.getMessage());
                    }
                });

            } catch (Exception e) {
                Log.e(TAG, "Error downloading or installing APK", e);
                call.reject("APK download failed: " + e.getMessage());
            } finally {
                try {
                    if (out != null) out.close();
                    if (in != null) in.close();
                    if (conn != null) conn.disconnect();
                } catch (Exception ignored) {}
            }
        }).start();
    }
}
