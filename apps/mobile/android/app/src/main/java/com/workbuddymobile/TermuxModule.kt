package com.workbuddymobile

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.facebook.react.bridge.*
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

object TermuxResults {
  private data class Waiting(val action: String, val promise: Promise, val pending: PendingIntent, val timeout: Runnable)
  private val handler = Handler(Looper.getMainLooper())
  private val waiting = ConcurrentHashMap<String, Waiting>()
  fun register(nonce: String, action: String, promise: Promise, pending: PendingIntent) {
    val timeout = Runnable {
      waiting.remove(nonce)?.let { it.pending.cancel(); it.promise.reject("TERMUX_TIMEOUT", "Termux 未返回结果，请打开 Termux 检查权限和进程。") }
    }
    waiting[nonce] = Waiting(action, promise, pending, timeout)
    handler.postDelayed(timeout, 90000)
  }
  fun fail(nonce: String) {
    waiting.remove(nonce)?.let { handler.removeCallbacks(it.timeout); it.pending.cancel(); it.promise.reject("TERMUX_START_FAILED", "无法启动 Termux，请检查授权。") }
  }
  fun complete(context: Context, nonce: String, intent: Intent) {
    val item = waiting.remove(nonce) ?: return
    handler.removeCallbacks(item.timeout); item.pending.cancel()
    try {
      val result = intent.getBundleExtra("result") ?: error("NO_RESULT")
      val exitCode = result.getInt("exitCode", -1)
      require(result.getInt("err", Int.MIN_VALUE) == -1 && (exitCode == 0 || (item.action == "doctor" && exitCode == 1)))
      val stdout = result.getString("stdout", "") ?: ""
      require(stdout.length <= 65536)
      val data = JSONObject(stdout)
      if (item.action == "start") PairingStore(context).save(data)
      if (item.action == "stop") PairingStore(context).clear()
      // Pairing secret never appears in logs or a generic command-result event.
      item.promise.resolve(Arguments.createMap().apply {
        putBoolean("ok", true)
        if (item.action == "doctor") putString("report", data.toString())
      })
    } catch (_: Exception) { item.promise.reject("TERMUX_COMMAND_FAILED", "操作未完成，请在 Termux 检查环境和登录状态。") }
  }
}

class TermuxModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "TermuxLauncher"
  private val permission = "com.termux.permission.RUN_COMMAND"
  private val settings = context.getSharedPreferences("workbuddy_settings", Context.MODE_PRIVATE)

  @ReactMethod fun status(promise: Promise) {
    var installed = true
    try { context.packageManager.getPackageInfo("com.termux", 0) } catch (_: PackageManager.NameNotFoundException) { installed = false }
    promise.resolve(Arguments.createMap().apply {
      putBoolean("installed", installed)
      putBoolean("permission", context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED)
      putString("repo", settings.getString("repo", "${TermuxCommands.HOME}/workbuddy-lite"))
      putString("version", settings.getString("version", ""))
    })
  }
  @ReactMethod fun saveSettings(repo: String, version: String, promise: Promise) {
    if (!TermuxCommands.validRepo(repo) || (version.isNotEmpty() && !version.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+")))) {
      promise.reject("INVALID_SETTINGS", "仓库需位于 Termux HOME 内；CLI 版本需为精确版本号。"); return
    }
    settings.edit().putString("repo", repo).putString("version", version).apply(); promise.resolve(null)
  }
  @ReactMethod fun pairing(promise: Promise) {
    try {
      val data = PairingStore(context).read()
      promise.resolve(data?.let { Arguments.createMap().apply {
        putInt("port", it.getInt("port")); putString("token", it.getString("token")); putString("instance", it.getString("instance"))
      } })
    } catch (_: Exception) { promise.reject("PAIRING_LOST", "配对信息无法解密，请重新启动并配对。"); }
  }
  @ReactMethod fun openSettings(promise: Promise) {
    try { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(null) }
    catch (_: Exception) { promise.reject("SETTINGS_FAILED", "无法打开系统设置。"); }
  }
  @ReactMethod fun openTermux(promise: Promise) {
    val launch = context.packageManager.getLaunchIntentForPackage("com.termux")
    if (launch == null) promise.reject("TERMUX_MISSING", "请先安装并打开 Termux。")
    else { context.startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(null) }
  }
  @ReactMethod fun launch(action: String, repo: String, version: String, promise: Promise) {
    if (context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("PERMISSION_REQUIRED", "请在本 App 的系统设置中授予“在 Termux 环境运行命令”权限。"); return
    }
    try {
      val command = TermuxCommands.create(action, repo, version)
      val intent = Intent("com.termux.RUN_COMMAND").setClassName("com.termux", "com.termux.app.RunCommandService")
        .putExtra("com.termux.RUN_COMMAND_PATH", command.executable)
        .putExtra("com.termux.RUN_COMMAND_ARGUMENTS", command.arguments)
        .putExtra("com.termux.RUN_COMMAND_WORKDIR", repo)
        .putExtra("com.termux.RUN_COMMAND_BACKGROUND", !command.foreground)
        .putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0")
      var nonce: String? = null
      if (!command.foreground) {
        nonce = UUID.randomUUID().toString()
        val callback = Intent(context, TermuxResultReceiver::class.java).setData(Uri.parse("workbuddy-result://command/$nonce"))
        val flags = PendingIntent.FLAG_ONE_SHOT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        val pending = PendingIntent.getBroadcast(context, 0, callback, flags)
        intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pending)
        TermuxResults.register(nonce, action, promise, pending)
      }
      try { context.startService(intent) } catch (error: Exception) { if (nonce != null) TermuxResults.fail(nonce) else throw error; return }
      if (command.foreground) promise.resolve(Arguments.createMap().apply { putBoolean("launched", true) })
    } catch (_: Exception) { promise.reject("TERMUX_START_FAILED", "无法执行该操作，请检查仓库路径、精确版本和 Termux 权限。"); }
  }
}
