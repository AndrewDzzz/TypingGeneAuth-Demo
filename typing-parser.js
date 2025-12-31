/**
 * TypingDNA Pattern Parser
 * 负责解析 TypingDNA 数据和基础统计计算
 */

const TypingParser = {

  // ============================================================
  // 解析 TypingDNA Pattern 字符串
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
    
    // 过滤有效数据
    const seekTimes = keystrokes.map(k => k.seekTime).filter(t => t > 0);
    const pressTimes = keystrokes.map(k => k.pressTime).filter(t => t > 0);
    
    // 计算统计值
    const seekStats = this.calcStats(seekTimes);
    const pressStats = this.calcStats(pressTimes);
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
  // 基础统计计算
  // ============================================================
  calcStats(arr) {
    if (!arr || !arr.length) return { avg: 0, min: 0, max: 0, std: 0, range: 0 };
    
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const std = arr.length > 1 
      ? Math.sqrt(arr.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / arr.length)
      : 0;
    
    return {
      avg: Math.round(avg),
      min,
      max,
      std: Math.round(std),
      range: max - min
    };
  },

  // ============================================================
  // 高级统计分析（分布特征）
  // ============================================================
  analyzeDistribution(values) {
    if (!values || values.length < 4) {
      return { valid: false };
    }
    
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const std = Math.sqrt(variance);
    
    if (std === 0) return { valid: true, isUniform: true };
    
    // 偏度 (skewness) - 分布的不对称性
    const skewness = values.reduce((sum, v) => sum + Math.pow((v - mean) / std, 3), 0) / n;
    
    // 峰度 (kurtosis) - 分布的尾部特征
    const kurtosis = values.reduce((sum, v) => sum + Math.pow((v - mean) / std, 4), 0) / n - 3;
    
    // 圆整数比例（10ms 的倍数）
    const roundNumbers = values.filter(v => v % 10 === 0).length;
    const roundNumberRatio = roundNumbers / n;
    
    // 连续相似值检测
    let maxConsecutiveSimilar = 1;
    let currentStreak = 1;
    for (let i = 1; i < values.length; i++) {
      if (Math.abs(values[i] - values[i-1]) < 10) {
        currentStreak++;
        maxConsecutiveSimilar = Math.max(maxConsecutiveSimilar, currentStreak);
      } else {
        currentStreak = 1;
      }
    }
    
    // 变异系数 (CV) - std/mean
    const cv = mean > 0 ? std / mean : 0;
    
    return {
      valid: true,
      mean: Math.round(mean),
      std: Math.round(std),
      skewness: Math.round(skewness * 100) / 100,
      kurtosis: Math.round(kurtosis * 100) / 100,
      roundNumberRatio: Math.round(roundNumberRatio * 100) / 100,
      maxConsecutiveSimilar,
      range: Math.max(...values) - Math.min(...values),
      cv: Math.round(cv * 100) / 100
    };
  },

  // ============================================================
  // 分析鼠标轨迹基础特征
  // ============================================================
  analyzeTrajectory(trajectory) {
    if (!trajectory || !trajectory.sample || trajectory.sample.length < 3) {
      return { valid: false, points: 0, distance: 0 };
    }
    
    const points = trajectory.sample;
    
    // 计算总距离
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i-1].x;
      const dy = points[i].y - points[i-1].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }
    
    // 计算平滑度（角度变化）
    let smoothSegments = 0;
    let corrections = 0;
    
    for (let i = 2; i < points.length; i++) {
      const v1 = { x: points[i-1].x - points[i-2].x, y: points[i-1].y - points[i-2].y };
      const v2 = { x: points[i].x - points[i-1].x, y: points[i].y - points[i-1].y };
      
      const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
      const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
      
      if (mag1 > 0 && mag2 > 0) {
        const dot = v1.x * v2.x + v1.y * v2.y;
        const cosAngle = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
        const angle = Math.acos(cosAngle);
        
        if (angle < 0.1) smoothSegments++;
        if (angle > 0.09 && angle < 0.52) corrections++;
      }
    }
    
    const smoothRatio = points.length > 2 ? smoothSegments / (points.length - 2) : 0;
    const correctionRatio = points.length > 2 ? corrections / (points.length - 2) : 0;
    
    // 计算时间间隔统计
    let intervalStats = null;
    if (points.length > 3 && points[0].t) {
      const intervals = [];
      for (let i = 1; i < points.length; i++) {
        intervals.push(points[i].t - points[i-1].t);
      }
      intervalStats = this.analyzeDistribution(intervals);
    }
    
    return {
      valid: true,
      points: points.length,
      distance: Math.round(totalDistance),
      smoothRatio: Math.round(smoothRatio * 100) / 100,
      correctionRatio: Math.round(correctionRatio * 100) / 100,
      intervalStats
    };
  }
};

// 导出
if (typeof module !== "undefined" && module.exports) {
  module.exports = TypingParser;
}
