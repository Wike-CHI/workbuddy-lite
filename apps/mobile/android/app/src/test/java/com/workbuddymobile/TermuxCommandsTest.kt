package com.workbuddymobile

import org.junit.Assert.*
import org.junit.Test

class TermuxCommandsTest {
  private val repo = "${TermuxCommands.HOME}/workbuddy-lite"
  @Test fun rejectsTraversalAndUnknownActions() {
    for (path in listOf("/sdcard/repo", "$repo/../other", "$repo//nested", "$repo/", "$repo\n")) assertFalse(TermuxCommands.validRepo(path))
    for (action in listOf("bash", "eval", "arbitrary")) {
      try { TermuxCommands.create(action, repo, "1.2.3"); fail("Unexpected action") } catch (_: IllegalArgumentException) {}
    }
  }
  @Test fun installPinsVersionAndNeverBuildsShellCommandString() {
    try { TermuxCommands.create("install", repo, "latest; touch x"); fail("Unpinned version") } catch (_: IllegalArgumentException) {}
    val command = TermuxCommands.create("install", "$repo with spaces", "1.2.3")
    assertEquals("${TermuxCommands.BIN}/bash", command.executable)
    assertArrayEquals(arrayOf("$repo with spaces/scripts/android/bootstrap.sh", "1.2.3"), command.arguments)
    assertTrue(command.foreground)
    assertFalse(TermuxCommands.create("start", repo, "").foreground)
    assertTrue(TermuxCommands.create("login", repo, "").arguments.isEmpty())
  }
}
