/**
 * Automation Detector
 * 负责检测自动化脚本/机器人行为
 * 依赖: typing-parser.js
 */

const AutomationDetector = {

  // ============================================================
  // 阈值配置
  // ============================================================
  thresholds: {
    // SeekTime 阈值
    seekTime: {
      botMax: 50,           // 机器人 seekTime 通常 < 50ms
      humanMin: 80,         // 人类 seekTime 通常 > 80ms
      tooFast: 30,          // 极快（脚本）
      uniformStdMax: 20,    // std < 20ms 太均匀
    },
    // PressTime 阈值
    pressTime: {
      botMax: 20,           // 机器人 pressTime 通常 < 20ms
      humanMin: 40,         // 人类 pressTime 通常 > 40ms
      uniformStdMax: 10,    // std < 10ms 太均匀
    },
    // 轨迹阈值
    trajectory: {
      minPoints: 3,
      minDistance: 50,
    },
    // 时间间隔阈值
    timing: {
      userToPassMin: 300,
      passToLoginMin: 100,
    },
    // 反自动化阈值
    antiBot: {
      seekTimeMinRange: 100,
      pressTimeMinRange: 30,
      skewnessThreshold: 0.3,
      kurtosisMin: -1,
      kurtosisMax: 3,
      roundNumberRatio: 0.3,
      consecutiveSimilarMax: 3,
      trajectorySmoothMax: 0.8,
      trajectoryCorrectionMin: 0.1,
      trajectoryIntervalCVMax: 0.3,
      cvMin: 0.15,
      cvMax: 0.35
    },
    // 最终判定阈值
    decision: {
      botProbabilityThreshold: 70  // Bot Probability > 70% 才判定为自动化
    }
  },

  // ============================================================
  // 检测高斯分布模式（机器人特征）
  // ============================================================
  detectGaussianPattern(distribution) {
    if (!distribution || !distribution.valid) return [];
    
    const flags = [];
    const th = this.thresholds.antiBot;
    
    // 1. 分布太接近正态分布
    const isNearNormal = Math.abs(distribution.skewness) < th.skewnessThreshold && 
                         distribution.kurtosis > th.kurtosisMin && 
                         distribution.kurtosis < th.kurtosisMax;
    
    if (isNearNormal) {
      flags.push({
        type: "bot",
        weight: 2,
        reason: `Distribution too close to Gaussian (skew=${distribution.skewness}, kurtosis=${distribution.kurtosis})`
      });
    }
    
    // 2. 圆整数过多
    if (distribution.roundNumberRatio > th.roundNumberRatio) {
      flags.push({
        type: "bot",
        weight: 2,
        reason: `Too many round numbers (${Math.round(distribution.roundNumberRatio * 100)}% are multiples of 10ms)`
      });
    }
    
    // 3. 连续相似值
    if (distribution.maxConsecutiveSimilar > th.consecutiveSimilarMax) {
      flags.push({
        type: "bot",
        weight: 2,
        reason: `${distribution.maxConsecutiveSimilar} consecutive similar intervals detected`
      });
    }
    
    // 4. 变异系数在可疑范围
    if (distribution.cv > th.cvMin && distribution.cv < th.cvMax) {
      flags.push({
        type: "bot",
        weight: 2,
        reason: `Coefficient of variation suggests programmatic randomness (CV=${distribution.cv})`
      });
    }
    
    return flags;
  },

  // ============================================================
  // 检测鼠标轨迹自动化特征
  // ============================================================
  detectTrajectoryAutomation(trajectoryAnalysis) {
    if (!trajectoryAnalysis || !trajectoryAnalysis.valid) return [];
    
    const flags = [];
    const th = this.thresholds.antiBot;
    
    // 1. 轨迹太平滑（贝塞尔曲线特征）
    if (trajectoryAnalysis.smoothRatio > th.trajectorySmoothMax) {
      flags.push({
        type: "bot",
        weight: 3,
        reason: `Mouse trajectory too smooth (${Math.round(trajectoryAnalysis.smoothRatio * 100)}%), likely Bezier curve`
      });
    }
    
    // 2. 缺少微修正
    if (trajectoryAnalysis.correctionRatio < th.trajectoryCorrectionMin && trajectoryAnalysis.points > 10) {
      flags.push({
        type: "bot",
        weight: 2,
        reason: `No micro-corrections in mouse movement (${Math.round(trajectoryAnalysis.correctionRatio * 100)}%)`
      });
    }
    
    // 3. 时间间隔太均匀
    if (trajectoryAnalysis.intervalStats && 
        trajectoryAnalysis.intervalStats.valid && 
        trajectoryAnalysis.intervalStats.cv < th.trajectoryIntervalCVMax) {
      flags.push({
        type: "bot",
        weight: 2,
        reason: `Mouse movement timing too uniform (CV=${trajectoryAnalysis.intervalStats.cv})`
      });
    }
    
    return flags;
  },

  // ============================================================
  // 检测 WebDriver/自动化工具
  // ============================================================
  detectWebDriver(stats) {
    const flags = [];
    
    // 1. navigator.webdriver
    if (stats.webdriverDetected) {
      flags.push({
        type: "bot",
        weight: 5,
        reason: "WebDriver automation detected (navigator.webdriver)"
      });
    }
    
    // 2. 自动化工具特征
    if (stats.automationFlags) {
      if (stats.automationFlags.hasChromiumAutomation) {
        flags.push({ type: "bot", weight: 3, reason: "Chromium automation flags detected" });
      }
      if (stats.automationFlags.hasSelenium) {
        flags.push({ type: "bot", weight: 5, reason: "Selenium WebDriver detected" });
      }
      if (stats.automationFlags.hasPhantom) {
        flags.push({ type: "bot", weight: 5, reason: "PhantomJS detected" });
      }
      if (stats.automationFlags.headlessChrome) {
        flags.push({ type: "bot", weight: 4, reason: "HeadlessChrome detected" });
      }
      if (stats.automationFlags.noPlugins) {
        // 降低权重，因为某些正常浏览器也可能没有插件
        flags.push({ type: "bot", weight: 0, reason: "No browser plugins (possible headless)" });
      }
      if (stats.automationFlags.zeroWindowSize) {
        flags.push({ type: "bot", weight: 3, reason: "Zero window size (headless browser)" });
      }
    }
    
    return flags;
  },

  // ============================================================
  // 检测合成事件 (event.isTrusted)
  // ============================================================
  detectSyntheticEvents(stats) {
    const flags = [];
    
    // 不可信事件
    if (stats.untrustedEvents > 0) {
      flags.push({
        type: "bot",
        weight: 3,
        reason: `Detected ${stats.untrustedEvents} untrusted (synthetic) events`
      });
    }
    
    // 合成键盘事件比例
    if (stats.syntheticKeyEvents !== undefined && stats.totalKeyEvents > 0) {
      const syntheticRatio = stats.syntheticKeyEvents / stats.totalKeyEvents;
      if (syntheticRatio > 0.3) {
        flags.push({
          type: "bot",
          weight: 4,
          reason: `High ratio of synthetic keyboard events (${Math.round(syntheticRatio * 100)}%)`
        });
      }
    }
    
    return flags;
  },

  // ============================================================
  // 分析单字段打字特征
  // ============================================================
  analyzeFieldTyping(pattern) {
    if (!pattern || pattern.keystrokeCount === 0) {
      return { valid: false, botFlags: [], humanFlags: [] };
    }

    const botFlags = [];
    const humanFlags = [];
    const th = this.thresholds;
    
    // SeekTime 分析
    if (pattern.seekTime.avg < th.seekTime.tooFast) {
      botFlags.push({ weight: 3, reason: `Extremely short key interval (${pattern.seekTime.avg}ms < ${th.seekTime.tooFast}ms)` });
    } else if (pattern.seekTime.avg < th.seekTime.botMax) {
      botFlags.push({ weight: 2, reason: `Key interval too short (${pattern.seekTime.avg}ms < ${th.seekTime.botMax}ms)` });
    }
    
    if (pattern.seekTime.std < th.seekTime.uniformStdMax && pattern.keystrokeCount > 3) {
      botFlags.push({ weight: 2, reason: `Key interval too uniform (std=${pattern.seekTime.std}ms)` });
    }
    
    // PressTime 分析
    if (pattern.pressTime.avg > 0 && pattern.pressTime.avg < th.pressTime.botMax) {
      botFlags.push({ weight: 2, reason: `Extremely short key press (${pattern.pressTime.avg}ms < ${th.pressTime.botMax}ms)` });
    }
    
    if (pattern.pressTime.std < th.pressTime.uniformStdMax && pattern.keystrokeCount > 3 && pattern.pressTime.avg > 0) {
      botFlags.push({ weight: 2, reason: `Key press too uniform (std=${pattern.pressTime.std}ms)` });
    }
    
    // SeekTime 范围太窄
    if (pattern.seekTime.range < th.antiBot.seekTimeMinRange && pattern.keystrokeCount > 5) {
      botFlags.push({ weight: 2, reason: `SeekTime range too narrow (${pattern.seekTime.range}ms < ${th.antiBot.seekTimeMinRange}ms)` });
    }
    
    // 人类指标
    if (pattern.seekTime.avg > th.seekTime.humanMin) {
      humanFlags.push({ weight: 1, reason: `Normal key interval (${pattern.seekTime.avg}ms)` });
    }
    
    if (pattern.pressTime.avg > th.pressTime.humanMin) {
      humanFlags.push({ weight: 1, reason: `Normal key press (${pattern.pressTime.avg}ms)` });
    }
    
    if (pattern.longPauses > 0) {
      humanFlags.push({ weight: 2, reason: `Has long pauses (${pattern.longPauses}x > 500ms)` });
    }
    
    return { valid: true, botFlags, humanFlags };
  },

  // ============================================================
  // 检测密码复杂度与击键行为不匹配
  // ============================================================
  detectPasswordMismatch(stats) {
    const flags = [];
    const password = stats.password || "";
    const shiftCount = stats.passwordShiftCount || stats.shiftCount || 0;
    const capsLockCount = stats.passwordCapsLockCount || stats.capsLockCount || 0;
    const pastePass = stats.pastePass || 0;
    
    if (!password) return { flags, details: null };
    
    const hasUpperCase = /[A-Z]/.test(password);
    const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);
    const needsShift = hasUpperCase || hasSpecialChar;
    const usedShiftOrCaps = shiftCount > 0 || capsLockCount > 0;
    const usedPaste = pastePass > 0;
    
    if (needsShift && !usedShiftOrCaps && !usedPaste) {
      flags.push({
        type: "bot",
        weight: 3,
        reason: "Password has uppercase/special chars but no Shift/CapsLock and not pasted"
      });
    }
    
    return {
      flags,
      details: { hasUpperCase, hasSpecialChar, needsShift, usedShiftOrCaps, usedPaste }
    };
  },

  // ============================================================
  // 完整登录行为分析
  // ============================================================
  analyze(stats, parser = null) {
    // 如果没有传入 parser，使用全局的 TypingParser
    const _parser = parser || (typeof TypingParser !== "undefined" ? TypingParser : null);
    if (!_parser) {
      console.error("TypingParser not found");
      return { isBot: false, confidence: 0, reasons: [] };
    }

    const result = {
      isBot: false,
      confidence: 0,
      reasons: [],
      details: {},
      scores: { bot: 0, human: 0 }
    };
    
    let botScore = 0;
    let humanScore = 0;
    
    // ==================== 1. 解析打字数据 ====================
    const userPattern = _parser.parsePattern(stats.typingdna?.lastUserTp);
    const passPattern = _parser.parsePattern(stats.typingdna?.lastPassTp);
    result.details.userPattern = userPattern;
    result.details.passPattern = passPattern;
    
    // ==================== 2. 分析打字特征 ====================
    if (userPattern) {
      const userAnalysis = this.analyzeFieldTyping(userPattern);
      result.details.userAnalysis = userAnalysis;
      
      userAnalysis.botFlags.forEach(f => {
        botScore += f.weight;
        result.reasons.push(`[Username] ${f.reason}`);
      });
      userAnalysis.humanFlags.forEach(f => humanScore += f.weight);
      
      // 分布分析
      if (userPattern.raw.seekTimes.length > 4) {
        const dist = _parser.analyzeDistribution(userPattern.raw.seekTimes);
        const gaussFlags = this.detectGaussianPattern(dist);
        result.details.userSeekDistribution = dist;
        gaussFlags.forEach(f => {
          botScore += f.weight;
          result.reasons.push(`[Username SeekTime] ${f.reason}`);
        });
      }
    }
    
    if (passPattern) {
      const passAnalysis = this.analyzeFieldTyping(passPattern);
      result.details.passAnalysis = passAnalysis;
      
      passAnalysis.botFlags.forEach(f => {
        botScore += f.weight;
        result.reasons.push(`[Password] ${f.reason}`);
      });
      passAnalysis.humanFlags.forEach(f => humanScore += f.weight);
      
      // 分布分析
      if (passPattern.raw.seekTimes.length > 4) {
        const dist = _parser.analyzeDistribution(passPattern.raw.seekTimes);
        const gaussFlags = this.detectGaussianPattern(dist);
        result.details.passSeekDistribution = dist;
        gaussFlags.forEach(f => {
          botScore += f.weight;
          result.reasons.push(`[Password SeekTime] ${f.reason}`);
        });
      }
    }
    
    // ==================== 3. 时间间隔分析 ====================
    const th = this.thresholds;
    
    if (stats.usernameToPasswordMs != null && stats.usernameToPasswordMs < th.timing.userToPassMin) {
      botScore += 2;
      result.reasons.push(`Username to password too fast (${stats.usernameToPasswordMs}ms < ${th.timing.userToPassMin}ms)`);
    }
    
    if (stats.passwordToLoginMs != null && stats.passwordToLoginMs < th.timing.passToLoginMin) {
      botScore += 2;
      result.reasons.push(`Password to login too fast (${stats.passwordToLoginMs}ms < ${th.timing.passToLoginMin}ms)`);
    }
    
    // ==================== 4. 鼠标轨迹分析 ====================
    if (stats.trajectory) {
      const trajAnalysis = _parser.analyzeTrajectory(stats.trajectory);
      result.details.trajectoryAnalysis = trajAnalysis;
      
      if (trajAnalysis.valid) {
        // 基础检测
        if (trajAnalysis.points < th.trajectory.minPoints) {
          botScore += 1;
          result.reasons.push(`Too few trajectory points (${trajAnalysis.points} < ${th.trajectory.minPoints})`);
        }
        if (trajAnalysis.distance < th.trajectory.minDistance && stats.trajectory.captured) {
          botScore += 1;
          result.reasons.push(`Mouse distance too short (${trajAnalysis.distance}px < ${th.trajectory.minDistance}px)`);
        }
        if (trajAnalysis.points > 5 && trajAnalysis.distance > 100) {
          humanScore += 2;
        }
        
        // 高级轨迹检测
        const trajFlags = this.detectTrajectoryAutomation(trajAnalysis);
        trajFlags.forEach(f => {
          botScore += f.weight;
          result.reasons.push(`[Trajectory] ${f.reason}`);
        });
      }
    }
    
    // ==================== 5. 粘贴检测 ====================
    if (stats.pasteUser > 0) {
      botScore += 1;
      result.reasons.push("Username was pasted");
    }
    if (stats.pastePass > 0) {
      botScore += 1;
      result.reasons.push("Password was pasted");
    }
    
    // ==================== 6. IME 输入法检测（人类指标）====================
    const imeTotal = (stats.imeUser || 0) + (stats.imePass || 0);
    if (imeTotal > 0) {
      humanScore += 3;
      result.details.ime = imeTotal;
    }
    
    // ==================== 7. Shift/CapsLock 检测（人类指标）====================
    const shiftCount = stats.shiftCount || 0;
    const capsLockCount = stats.capsLockCount || 0;
    
    if (shiftCount > 0) {
      humanScore += 2;
      result.details.shift = shiftCount;
    }
    if (capsLockCount > 0) {
      humanScore += 1;
      result.details.capsLock = capsLockCount;
    }
    
    // ==================== 8. 密码复杂度不匹配检测 ====================
    const pwdMismatch = this.detectPasswordMismatch(stats);
    result.details.passwordAnalysis = pwdMismatch.details;
    pwdMismatch.flags.forEach(f => {
      botScore += f.weight;
      result.reasons.push(f.reason);
    });
    
    // ==================== 9. WebDriver/自动化工具检测 ====================
    const webdriverFlags = this.detectWebDriver(stats);
    webdriverFlags.forEach(f => {
      botScore += f.weight;
      result.reasons.push(`[Automation] ${f.reason}`);
    });
    
    // ==================== 10. 合成事件检测 ====================
    const syntheticFlags = this.detectSyntheticEvents(stats);
    syntheticFlags.forEach(f => {
      botScore += f.weight;
      result.reasons.push(`[Events] ${f.reason}`);
    });
    
    // ==================== 计算最终结果 ====================
    const totalScore = botScore + humanScore;
    result.confidence = totalScore > 0 ? Math.round((botScore / totalScore) * 100) : 0;
    result.scores = { bot: botScore, human: humanScore };
    
    // 判定：仅当 confidence > 70% 时判定为 Bot
    result.isBot = result.confidence > th.decision.botProbabilityThreshold;
    
    return result;
  },

  // ============================================================
  // 生成分析报告
  // ============================================================
  generateReport(stats, parser = null) {
    const analysis = this.analyze(stats, parser);
    const lines = [];
    
    lines.push("=== Login Behavior Analysis Report ===\n");
    
    // 结论
    lines.push(`[Result]`);
    lines.push(`- Verdict: ${analysis.isBot ? "🤖 Bot/Script" : "✅ Human"}`);
    lines.push(`- Bot Probability: ${analysis.confidence}%`);
    lines.push(`- Scores: Bot=${analysis.scores.bot}, Human=${analysis.scores.human}`);
    lines.push("");
    
    // 检测到的异常
    if (analysis.reasons.length > 0) {
      lines.push(`[Anomalies Detected]`);
      analysis.reasons.forEach(r => lines.push(`  ⚠️ ${r}`));
      lines.push("");
    }
    
    // 打字特征
    const userPattern = analysis.details.userPattern;
    if (userPattern) {
      lines.push(`[Username Typing]`);
      lines.push(`- Keystrokes: ${userPattern.keystrokeCount}`);
      lines.push(`- SeekTime: avg=${userPattern.seekTime.avg}ms, std=${userPattern.seekTime.std}ms, range=${userPattern.seekTime.range}ms`);
      lines.push(`- PressTime: avg=${userPattern.pressTime.avg}ms, std=${userPattern.pressTime.std}ms`);
      lines.push("");
    }
    
    const passPattern = analysis.details.passPattern;
    if (passPattern) {
      lines.push(`[Password Typing]`);
      lines.push(`- Keystrokes: ${passPattern.keystrokeCount}`);
      lines.push(`- SeekTime: avg=${passPattern.seekTime.avg}ms, std=${passPattern.seekTime.std}ms, range=${passPattern.seekTime.range}ms`);
      lines.push(`- PressTime: avg=${passPattern.pressTime.avg}ms, std=${passPattern.pressTime.std}ms`);
      lines.push("");
    }
    
    // 其他特征
    lines.push(`[Other Features]`);
    if (analysis.details.ime) lines.push(`- IME Usage: ${analysis.details.ime}x ✅`);
    if (analysis.details.shift) lines.push(`- Shift Usage: ${analysis.details.shift}x ✅`);
    if (analysis.details.capsLock) lines.push(`- CapsLock Usage: ${analysis.details.capsLock}x ✅`);
    
    return lines.join("\n");
  }
};

// 导出
if (typeof module !== "undefined" && module.exports) {
  module.exports = AutomationDetector;
}
