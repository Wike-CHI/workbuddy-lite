package com.workbuddymobile

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class PairingStore(context: Context) {
  private val prefs = context.getSharedPreferences("workbuddy_private", Context.MODE_PRIVATE)
  private val alias = "workbuddy_pairing_v1"
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  fun save(config: JSONObject) {
    require(config.getInt("port") in 1..65535)
    require(config.getString("token").matches(Regex("[a-f0-9]{64}")))
    require(config.getString("instance").matches(Regex("[a-f0-9-]{36}")))
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val bytes = cipher.iv + cipher.doFinal(config.toString().toByteArray(Charsets.UTF_8))
    check(prefs.edit().putString("pairing", Base64.encodeToString(bytes, Base64.NO_WRAP)).commit())
  }
  fun read(): JSONObject? {
    val encoded = prefs.getString("pairing", null) ?: return null
    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
  }
  fun clear() { check(prefs.edit().remove("pairing").commit()) }
}
