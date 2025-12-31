/**
 * TypingDNA Pattern Parser & Behavior Analyzer
 * Used to analyze login behavior and distinguish humans from bots
 */

const TypingAnalyzer = {
  
  // ============================================================
  // Threshold Configuration (based on decision tree training)
  // ============================================================
  thresholds: {
    // SeekTime thresholds
    seekTime: {
      botMax: 50,           // Bot seekTime typically < 50ms
      humanMin: 80,         // Human seekTime typically > 80ms
      tooFast: 30,          // Extremely fast (likely script)
      uniformStdMax: 20,    // std < 20ms considered too uniform
    },
    // PressTime thresholds
    pressTime: {
      botMax: 20,           // Bot pressTime typically < 20ms
      humanMin: 40,         // Human pressTime typically > 40ms
      uniformStdMax: 10,    // std < 10ms considered too uniform
    },
    // Trajectory thresholds
    trajectory: {
      minPoints: 3,         // Humans typically have multiple trajectory points
      minDistance: 50,      // Humans typically move > 50px
    },
    // Timing thresholds
    timing: {
      userToPassMin: 300,   // Min interval from username to password
      passToLoginMin: 100,  // Min interval from password to login
    },
    // IME input method
    ime: {
      humanIndicator: true  // Using IME is human indicator (bots don't use input methods)
    }
  },

  // ============================================================
  // Parse TypingDNA Pattern String
  // ============================================================
  parsePattern(patternStr) {
    if (!patternStr) return null;
    
    const segments = patternStr.split("|");
    if (segments.length < 2) return null;
    
    const keystrokes = segments.slice(1).map(seg => {
      const parts = seg.split(",");
      // TypingDNA pattern format: seekTime,pressTime
      return {
        seekTime: parseInt(parts[0]) || 0,
        pressTime: parseInt(parts[1]) || 0
      };
    });
    
    // Filter valid data
    const seekTimes = keystrokes.map(k => k.seekTime).filter(t => t > 0);
    const pressTimes = keystrokes.map(k => k.pressTime).filter(t => t > 0);
    
    // Calculate statistics
    const calcStats = (arr) => {
      if (!arr.length) return { avg: 0, min: 0, max: 0, std: 0 };
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      const std = arr.length > 1 
        ? Math.sqrt(arr.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / arr.length)
        : 0;
      return {
        avg: Math.round(avg),
        min: Math.min(...arr),
        max: Math.max(...arr),
        std: Math.round(std)
      };
    };
    
    const seekStats = calcStats(seekTimes);
    const pressStats = calcStats(pressTimes);
    const longPauses = seekTimes.filter(t => t > 500).length;
    
    return {
      keystrokeCount: keystrokes.length,
      seekTime: seekStats,
      pressTime: pressStats,
      longPauses,
      keystrokes,
      raw: {
        seekTimes,
        pressTimes
      }
    };
  },

  // ============================================================
  // Analyze Single Field Typing Features
  // ============================================================
  analyzeFieldTyping(pattern) {
    if (!pattern || pattern.keystrokeCount === 0) {
      return { valid: false, reason: "No typing data" };
    }

    const flags = [];
    const th = this.thresholds;
    
    // SeekTime analysis
    if (pattern.seekTime.avg < th.seekTime.tooFast) {
      flags.push({ type: "bot", feature: "seekTime", reason: `Extremely short key interval (${pattern.seekTime.avg}ms < ${th.seekTime.tooFast}ms)` });
    } else if (pattern.seekTime.avg < th.seekTime.botMax) {
      flags.push({ type: "bot", feature: "seekTime", reason: `Key interval too short (${pattern.seekTime.avg}ms < ${th.seekTime.botMax}ms)` });
    }
    
    if (pattern.seekTime.std < th.seekTime.uniformStdMax && pattern.keystrokeCount > 3) {
      flags.push({ type: "bot", feature: "seekTimeStd", reason: `Key interval too uniform (std=${pattern.seekTime.std}ms < ${th.seekTime.uniformStdMax}ms)` });
    }
    
    // PressTime analysis
    if (pattern.pressTime.avg > 0 && pattern.pressTime.avg < th.pressTime.botMax) {
      flags.push({ type: "bot", feature: "pressTime", reason: `Extremely short key press duration (${pattern.pressTime.avg}ms < ${th.pressTime.botMax}ms)` });
    }
    
    if (pattern.pressTime.std < th.pressTime.uniformStdMax && pattern.keystrokeCount > 3 && pattern.pressTime.avg > 0) {
      flags.push({ type: "bot", feature: "pressTimeStd", reason: `Key press duration too uniform (std=${pattern.pressTime.std}ms < ${th.pressTime.uniformStdMax}ms)` });
    }
    
    // Human indicators
    if (pattern.seekTime.avg > th.seekTime.humanMin) {
      flags.push({ type: "human", feature: "seekTime", reason: `Normal key interval (${pattern.seekTime.avg}ms)` });
    }
    
    if (pattern.pressTime.avg > th.pressTime.humanMin) {
      flags.push({ type: "human", feature: "pressTime", reason: `Normal key press duration (${pattern.pressTime.avg}ms)` });
    }
    
    if (pattern.longPauses > 0) {
      flags.push({ type: "human", feature: "longPauses", reason: `Has long pauses (${pattern.longPauses}x > 500ms), possibly thinking` });
    }
    
    return {
      valid: true,
      flags,
      botFlags: flags.filter(f => f.type === "bot"),
      humanFlags: flags.filter(f => f.type === "human")
    };
  },

  // ============================================================
  // Complete Login Behavior Analysis
  // ============================================================
  analyzeLogin(stats) {
    const result = {
      isBot: false,
      confidence: 0,
      reasons: [],
      details: {}
    };
    
    let botScore = 0;
    let humanScore = 0;
    
    // 1. Analyze username typing
    const userPattern = this.parsePattern(stats.typingdna?.lastUserTp);
    const userAnalysis = this.analyzeFieldTyping(userPattern);
    result.details.username = { pattern: userPattern, analysis: userAnalysis };
    
    if (userAnalysis.valid) {
      botScore += userAnalysis.botFlags.length * 2;
      humanScore += userAnalysis.humanFlags.length;
      userAnalysis.botFlags.forEach(f => result.reasons.push(`[Username] ${f.reason}`));
    }
    
    // 2. Analyze password typing
    const passPattern = this.parsePattern(stats.typingdna?.lastPassTp);
    const passAnalysis = this.analyzeFieldTyping(passPattern);
    result.details.password = { pattern: passPattern, analysis: passAnalysis };
    
    if (passAnalysis.valid) {
      botScore += passAnalysis.botFlags.length * 2;
      humanScore += passAnalysis.humanFlags.length;
      passAnalysis.botFlags.forEach(f => result.reasons.push(`[Password] ${f.reason}`));
    }
    
    // 3. Analyze timing intervals
    const th = this.thresholds;
    
    if (stats.usernameToPasswordMs != null && stats.usernameToPasswordMs < th.timing.userToPassMin) {
      botScore += 2;
      result.reasons.push(`Username to password interval too short (${stats.usernameToPasswordMs}ms < ${th.timing.userToPassMin}ms)`);
    }
    
    if (stats.passwordToLoginMs != null && stats.passwordToLoginMs < th.timing.passToLoginMin) {
      botScore += 2;
      result.reasons.push(`Password to login interval too short (${stats.passwordToLoginMs}ms < ${th.timing.passToLoginMin}ms)`);
    }
    
    // 4. Analyze mouse trajectory
    const traj = stats.trajectory;
    if (traj) {
      if (traj.points < th.trajectory.minPoints) {
        botScore += 1;
        result.reasons.push(`Too few mouse trajectory points (${traj.points} < ${th.trajectory.minPoints})`);
      }
      if (traj.distancePx < th.trajectory.minDistance && traj.captured) {
        botScore += 1;
        result.reasons.push(`Mouse movement distance too short (${traj.distancePx}px < ${th.trajectory.minDistance}px)`);
      }
      if (traj.points > 5 && traj.distancePx > 100) {
        humanScore += 2;
      }
    }
    
    // 5. Analyze paste behavior
    if (stats.pasteUser > 0) {
      botScore += 1;
      result.reasons.push("Username was pasted");
    }
    if (stats.pastePass > 0) {
      botScore += 1;
      result.reasons.push("Password was pasted");
    }
    
    // 6. Analyze IME input method usage (human indicator)
    const imeUserCount = stats.usernameIMECompositionCount || stats.imeUser || 0;
    const imePassCount = stats.passwordIMECompositionCount || stats.imePass || 0;
    const totalIME = imeUserCount + imePassCount;
    
    if (totalIME > 0) {
      // Using IME is a strong human indicator, bots don't trigger input methods
      humanScore += 3;
      result.details.ime = { username: imeUserCount, password: imePassCount, total: totalIME };
    }
    
    // 7. Analyze Shift/CapsLock usage (human indicator)
    const shiftCount = stats.passwordShiftCount || stats.shiftCount || 0;
    const capsLockCount = stats.passwordCapsLockCount || stats.capsLockCount || 0;
    const pastePass = stats.pastePass || 0;
    const password = stats.password || "";
    
    if (shiftCount > 0) {
      // Using Shift for uppercase or special chars is human indicator
      humanScore += 2;
      result.details.shift = shiftCount;
    }
    
    if (capsLockCount > 0) {
      // Using CapsLock is human indicator (bots send uppercase directly)
      humanScore += 1;
      result.details.capsLock = capsLockCount;
    }
    
    // 8. Detect password complexity vs keystroke behavior mismatch (bot indicator)
    // If password contains uppercase or special chars but no Shift/CapsLock and no paste, it's suspicious
    if (password) {
      const hasUpperCase = /[A-Z]/.test(password);
      const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);
      const needsShift = hasUpperCase || hasSpecialChar;
      const usedShiftOrCaps = shiftCount > 0 || capsLockCount > 0;
      const usedPaste = pastePass > 0;
      
      if (needsShift && !usedShiftOrCaps && !usedPaste) {
        // Password has uppercase/special chars but no Shift/CapsLock pressed and no paste → bot
        botScore += 3;
        result.reasons.push("Password contains uppercase or special chars but no Shift/CapsLock detected and not pasted");
      }
      
      result.details.passwordAnalysis = {
        hasUpperCase,
        hasSpecialChar,
        needsShift,
        usedShiftOrCaps,
        usedPaste
      };
    }
    
    // 9. Calculate final result
    const totalScore = botScore + humanScore;
    if (totalScore > 0) {
      result.confidence = Math.round((botScore / totalScore) * 100);
    }
    
    // Decision rules (based on decision tree)
    result.isBot = botScore >= 3 || result.confidence > 60;
    
    result.scores = { bot: botScore, human: humanScore };
    
    return result;
  },

  // ============================================================
  // Generate Analysis Report (text format)
  // ============================================================
  generateReport(stats) {
    const analysis = this.analyzeLogin(stats);
    const lines = [];
    
    lines.push("=== Login Behavior Analysis Report ===\n");
    
    // Conclusion
    lines.push(`[Result]`);
    lines.push(`- Verdict: ${analysis.isBot ? "🤖 Bot/Script" : "✅ Human"}`);
    lines.push(`- Bot Probability: ${analysis.confidence}%`);
    lines.push(`- Scores: Bot=${analysis.scores.bot}, Human=${analysis.scores.human}`);
    lines.push("");
    
    // Anomalies detected
    if (analysis.reasons.length > 0) {
      lines.push(`[Anomalies Detected]`);
      analysis.reasons.forEach(r => lines.push(`  ⚠️ ${r}`));
      lines.push("");
    }
    
    // Username typing details
    const userPattern = analysis.details.username?.pattern;
    if (userPattern) {
      lines.push(`[Username Typing Features]`);
      lines.push(`- Keystroke Count: ${userPattern.keystrokeCount}`);
      lines.push(`- SeekTime: avg=${userPattern.seekTime.avg}ms, range=${userPattern.seekTime.min}-${userPattern.seekTime.max}ms, std=${userPattern.seekTime.std}ms`);
      lines.push(`- PressTime: avg=${userPattern.pressTime.avg}ms, range=${userPattern.pressTime.min}-${userPattern.pressTime.max}ms, std=${userPattern.pressTime.std}ms`);
      lines.push(`- Long Pauses: ${userPattern.longPauses}x`);
      lines.push("");
    }
    
    // Password typing details
    const passPattern = analysis.details.password?.pattern;
    if (passPattern) {
      lines.push(`[Password Typing Features]`);
      lines.push(`- Keystroke Count: ${passPattern.keystrokeCount}`);
      lines.push(`- SeekTime: avg=${passPattern.seekTime.avg}ms, range=${passPattern.seekTime.min}-${passPattern.seekTime.max}ms, std=${passPattern.seekTime.std}ms`);
      lines.push(`- PressTime: avg=${passPattern.pressTime.avg}ms, range=${passPattern.pressTime.min}-${passPattern.pressTime.max}ms, std=${passPattern.pressTime.std}ms`);
      lines.push(`- Long Pauses: ${passPattern.longPauses}x`);
      lines.push("");
    }
    
    // Other features
    lines.push(`[Other Features]`);
    lines.push(`- Username→Password Interval: ${stats.usernameToPasswordMs ?? "Not recorded"}ms`);
    lines.push(`- Password→Login Interval: ${stats.passwordToLoginMs ?? "Not recorded"}ms`);
    lines.push(`- Paste Count: Username=${stats.pasteUser ?? 0}, Password=${stats.pastePass ?? 0}`);
    
    // IME usage
    const imeUserCount = stats.usernameIMECompositionCount || stats.imeUser || 0;
    const imePassCount = stats.passwordIMECompositionCount || stats.imePass || 0;
    if (imeUserCount > 0 || imePassCount > 0) {
      lines.push(`- IME Input Method: Username=${imeUserCount}x, Password=${imePassCount}x ✅ Human indicator`);
    } else {
      lines.push(`- IME Input Method: Not used`);
    }
    
    // Shift/CapsLock usage
    const shiftCount = stats.passwordShiftCount || stats.shiftCount || 0;
    const capsLockCount = stats.passwordCapsLockCount || stats.capsLockCount || 0;
    if (shiftCount > 0) {
      lines.push(`- Shift Key: ${shiftCount}x ✅ Human indicator`);
    }
    if (capsLockCount > 0) {
      lines.push(`- CapsLock Key: ${capsLockCount}x ✅ Human indicator`);
    }
    if (shiftCount === 0 && capsLockCount === 0) {
      lines.push(`- Shift/CapsLock: Not used`);
    }
    
    if (stats.trajectory) {
      lines.push(`- Mouse Trajectory: ${stats.trajectory.points} points, ${stats.trajectory.distancePx}px`);
    }
    
    return lines.join("\n");
  }
};

// Export (compatible with Node.js and browser)
if (typeof module !== "undefined" && module.exports) {
  module.exports = TypingAnalyzer;
}
