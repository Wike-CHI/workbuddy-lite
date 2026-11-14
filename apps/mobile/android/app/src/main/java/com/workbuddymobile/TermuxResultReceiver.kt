package com.workbuddymobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Non-exported receiver; only an explicitly addressed, one-shot PendingIntent reaches it.
class TermuxResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val nonce = intent.data?.lastPathSegment ?: return
    TermuxResults.complete(context, nonce, intent)
  }
}
