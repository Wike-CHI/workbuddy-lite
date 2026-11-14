package com.workbuddymobile

data class TermuxCommand(val executable: String, val arguments: Array<String>, val foreground: Boolean)

object TermuxCommands {
  const val HOME = "/data/data/com.termux/files/home"
  const val BIN = "/data/data/com.termux/files/usr/bin"
  fun validRepo(repo: String): Boolean = repo.startsWith("$HOME/") &&
    repo.length <= 512 && repo.split('/').drop(1).none { it == "." || it == ".." || it.isEmpty() } &&
    !repo.contains('\u0000') && !repo.contains('\n') && !repo.endsWith('/')

  fun create(action: String, repo: String, version: String): TermuxCommand {
    require(validRepo(repo)) { "INVALID_REPO" }
    return when (action) {
      "install" -> {
        require(version.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+"))) { "INVALID_VERSION" }
        TermuxCommand("$BIN/bash", arrayOf("$repo/scripts/android/bootstrap.sh", version), true)
      }
      "login" -> TermuxCommand("$BIN/codebuddy", emptyArray(), true)
      "doctor" -> TermuxCommand("$BIN/node", arrayOf("$repo/scripts/android/doctor.mjs"), false)
      "start", "stop" -> TermuxCommand("$BIN/node", arrayOf("$repo/packages/termux-bridge/service.mjs", action), false)
      else -> throw IllegalArgumentException("INVALID_ACTION")
    }
  }
}
