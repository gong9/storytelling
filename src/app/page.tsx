'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './page.module.css';

// ==================== 类型 ====================

type Status = 'idle' | 'uploading' | 'ready' | 'generating' | 'paused' | 'complete';

interface ChapterInfo {
  index: number;
  title: string;
  charCount: number;
  status: 'pending' | 'active' | 'done' | 'error';
  outputChars?: number;
  segmentsDone?: number;
  segmentsTotal?: number;
  error?: string;
}

interface SessionData {
  sessionId: string;
  title: string;
  totalChars: number;
  outputPath: string;
}

interface HistoryItem {
  id: string;
  title: string;
  totalChars: number;
  chapterCount: number;
  completedCount: number;
  outputPath: string;
  createdAt: number;
}

interface LogEntry {
  id: number;
  text: string;
  type: 'info' | 'tool' | 'result' | 'stage';
}

// 知识图谱类型（与后端保持一致）
interface KGCharacter {
  id: string;
  name: string;
  aliases?: string[];
  role: 'protagonist' | 'antagonist' | 'supporting';
  description: string;
}

interface KGRelationship {
  from: string;
  to: string;
  type: string;
  description?: string;
}

interface KGEvent {
  id: string;
  name: string;
  characters: string[];
  chapter?: number;
  description: string;
}

interface KnowledgeGraph {
  characters: KGCharacter[];
  relationships: KGRelationship[];
  events: KGEvent[];
}

// ==================== SVG 图标 ====================

function UploadIcon() {
  return (
    <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className={styles.btnIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

// ==================== SSE 工具 ====================

async function readSSE(
  response: Response,
  onEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          onEvent(JSON.parse(line.slice(6)));
        } catch {
          // skip
        }
      }
    }
  }
}

async function fetchSSE(
  url: string,
  body: Record<string, unknown>,
  onEvent: (data: Record<string, unknown>) => void,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  await readSSE(response, onEvent);
}

// ==================== TTS 图标 ====================

function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

// ==================== 知识图谱面板（力导向布局 + 拖拽） ====================

// 简单的力导向布局 hook
function useForceLayout(
  characters: KGCharacter[],
  relationships: KGRelationship[],
  width: number,
  height: number
) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // 初始化或更新节点位置
  useEffect(() => {
    if (characters.length === 0) return;

    setPositions((prev) => {
      const next: Record<string, { x: number; y: number }> = {};
      const existing = Object.keys(prev);

      characters.forEach((char, i) => {
        if (prev[char.id]) {
          // 保留已有位置
          next[char.id] = prev[char.id];
        } else {
          // 新节点：随机分布或按角度分布
          const angle = (2 * Math.PI * i) / characters.length - Math.PI / 2;
          const radius = Math.min(width, height) * 0.35;
          next[char.id] = {
            x: width / 2 + radius * Math.cos(angle) + (Math.random() - 0.5) * 40,
            y: height / 2 + radius * Math.sin(angle) + (Math.random() - 0.5) * 40,
          };
        }
      });

      // 只有新增节点时才触发力模拟
      if (existing.length < characters.length) {
        return runForceSimulation(next, relationships, width, height, 50);
      }
      return next;
    });
  }, [characters.length, relationships.length, width, height]);

  // MiroFish 风格力导向模拟
  function runForceSimulation(
    pos: Record<string, { x: number; y: number }>,
    rels: KGRelationship[],
    w: number,
    h: number,
    iterations: number
  ) {
    const nodes = Object.keys(pos).map((id) => ({ id, ...pos[id], vx: 0, vy: 0 }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const centerX = w / 2, centerY = h / 2;

    for (let iter = 0; iter < iterations; iter++) {
      const alpha = 1 - iter / iterations; // 逐渐衰减

      // 1. 斥力（所有节点互斥，类似 D3 forceManyBody）
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          // 强斥力 -400 / dist^2（类似 D3）
          const repulse = Math.min(300 / (dist * dist), 8) * alpha;
          const fx = (dx / dist) * repulse;
          const fy = (dy / dist) * repulse;
          a.vx -= fx; a.vy -= fy;
          b.vx += fx; b.vy += fy;
        }
      }

      // 2. 链接引力（有关系的节点相吸，理想距离 120）
      for (const rel of rels) {
        const a = nodeMap.get(rel.from), b = nodeMap.get(rel.to);
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealDist = 120;
        const force = (dist - idealDist) * 0.03 * alpha;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }

      // 3. 向心力（让图聚集在中心，类似 D3 forceX/forceY）
      for (const n of nodes) {
        n.vx += (centerX - n.x) * 0.008 * alpha;
        n.vy += (centerY - n.y) * 0.008 * alpha;
      }

      // 4. 碰撞检测（节点不重叠，碰撞半径 40）
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = 50;
          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const fx = (dx / dist) * overlap;
            const fy = (dy / dist) * overlap;
            a.x -= fx; a.y -= fy;
            b.x += fx; b.y += fy;
          }
        }
      }

      // 5. 应用速度 + 阻尼
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.vx *= 0.6; // 阻尼
        n.vy *= 0.6;
      }

      // 6. 边界约束
      const padding = 30;
      for (const n of nodes) {
        n.x = Math.max(padding, Math.min(w - padding, n.x));
        n.y = Math.max(padding, Math.min(h - padding, n.y));
      }
    }

    const result: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) result[n.id] = { x: n.x, y: n.y };
    return result;
  }

  // 拖拽处理
  const handleMouseDown = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(id);
    const pos = positions[id];
    if (pos) {
      dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPositions((prev) => ({
      ...prev,
      [dragging]: { x: Math.max(35, Math.min(width - 35, x)), y: Math.max(35, Math.min(height - 35, y)) },
    }));
  };

  const handleMouseUp = () => setDragging(null);

  return { positions, dragging, handleMouseDown, handleMouseMove, handleMouseUp };
}

// MiroFish 风格配色
const ROLE_COLORS: Record<string, string> = {
  protagonist: '#FF6B35',  // 橙红 - 主角
  antagonist: '#C5283D',   // 深红 - 反派
  supporting: '#004E89',   // 深蓝 - 配角
};

function KnowledgeGraphPanel({ graph, isLoading }: { graph: KnowledgeGraph | null; isLoading?: boolean }) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredRel, setHoveredRel] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPos = useRef({ x: 0, y: 0 });

  // 增大画布尺寸
  const WIDTH = 800;
  const HEIGHT = 680;

  const characters = graph?.characters || [];
  const relationships = graph?.relationships || [];

  const { positions, dragging, handleMouseDown, handleMouseMove, handleMouseUp } = useForceLayout(
    characters,
    relationships,
    WIDTH,
    HEIGHT
  );

  // 缩放处理（鼠标滚轮）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(3, z * delta)));
  }, []);

  // 平移处理（按住空格或中键拖拽）
  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey) { // 中键或 Alt 键
      e.preventDefault();
      setIsPanning(true);
      lastPanPos.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastPanPos.current.x;
      const dy = e.clientY - lastPanPos.current.y;
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      lastPanPos.current = { x: e.clientX, y: e.clientY };
    }
  }, [isPanning]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  // 重置视图
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // 没有数据且不在加载：不显示
  if (!graph && !isLoading) {
    return null;
  }

  // 没有数据但在加载：显示空白 loading
  if (!graph || graph.characters.length === 0) {
    return (
      <div className={styles.graphPanel}>
        <div className={styles.graphHeader}>
          <span className={styles.graphTitle}>人物关系图谱</span>
          <span className={styles.graphLoading}>构建中...</span>
        </div>
        <div className={styles.graphPlaceholder}>
          <div className={styles.spinner} />
        </div>
      </div>
    );
  }

  const hoveredChar = hoveredNode ? characters.find((c) => c.id === hoveredNode) : null;
  const hoveredRelData = hoveredRel !== null ? relationships[hoveredRel] : null;

  return (
    <div className={styles.graphPanel}>
      <div className={styles.graphHeader}>
        <span className={styles.graphTitle}>人物关系图谱</span>
        <span className={styles.graphStats}>
          {characters.length} 人物 · {relationships.length} 关系
          {isLoading && <span className={styles.graphLoading}> · 构建中</span>}
        </span>
      </div>
      <div className={styles.graphContainer}>
        {/* 缩放控制按钮 */}
        <div className={styles.zoomControls}>
          <button onClick={() => setZoom(z => Math.min(3, z * 1.2))} title="放大">+</button>
          <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.max(0.5, z * 0.8))} title="缩小">−</button>
          <button onClick={resetView} title="重置视图" className={styles.zoomReset}>⟲</button>
        </div>
        
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          className={styles.graphSvg}
          onWheel={handleWheel}
          onMouseDown={handlePanStart}
          onMouseMove={(e) => { handlePanMove(e); handleMouseMove(e); }}
          onMouseUp={(e) => { handlePanEnd(); handleMouseUp(); }}
          onMouseLeave={() => { handlePanEnd(); handleMouseUp(); }}
          style={{ cursor: isPanning ? 'move' : dragging ? 'grabbing' : 'default' }}
        >
          {/* 缩放和平移变换组 */}
          <g transform={`translate(${WIDTH/2 + pan.x}, ${HEIGHT/2 + pan.y}) scale(${zoom}) translate(${-WIDTH/2}, ${-HEIGHT/2})`}>
          {/* 关系连线 - MiroFish 风格曲线 */}
          {relationships.map((rel, i) => {
            const from = positions[rel.from];
            const to = positions[rel.to];
            if (!from || !to) return null;

            const isHovered = hoveredRel === i || hoveredNode === rel.from || hoveredNode === rel.to;
            
            // 计算同一对节点之间的边数量（用于曲线偏移）
            const pairKey = [rel.from, rel.to].sort().join('_');
            const sameEdges = relationships.filter(r => 
              [r.from, r.to].sort().join('_') === pairKey
            );
            const edgeIndex = sameEdges.indexOf(rel);
            const totalEdges = sameEdges.length;
            
            // 计算曲线路径
            const dx = to.x - from.x, dy = to.y - from.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            
            let path: string;
            if (totalEdges === 1) {
              // 单条边：直线
              path = `M${from.x},${from.y} L${to.x},${to.y}`;
            } else {
              // 多条边：曲线，根据索引偏移
              const curvature = ((edgeIndex / (totalEdges - 1)) - 0.5) * 0.8;
              const offsetX = -dy / dist * curvature * Math.max(40, dist * 0.3);
              const offsetY = dx / dist * curvature * Math.max(40, dist * 0.3);
              const cx = (from.x + to.x) / 2 + offsetX;
              const cy = (from.y + to.y) / 2 + offsetY;
              path = `M${from.x},${from.y} Q${cx},${cy} ${to.x},${to.y}`;
            }
            
            return (
              <path
                key={i}
                d={path}
                fill="none"
                stroke={isHovered ? '#3498db' : '#c0c0c0'}
                strokeWidth={isHovered ? 2.5 : 1.5}
                style={{ 
                  transition: 'stroke 0.15s, stroke-width 0.15s',
                  cursor: 'pointer'
                }}
                onMouseEnter={() => setHoveredRel(i)}
                onMouseLeave={() => setHoveredRel(null)}
              />
            );
          })}
          
          {/* 人物节点 - MiroFish 风格 */}
          {characters.map((char) => {
            const pos = positions[char.id];
            if (!pos) return null;

            const color = ROLE_COLORS[char.role] || ROLE_COLORS.supporting;
            const isHovered = hoveredNode === char.id;
            const isDragging = dragging === char.id;
            const isActive = isHovered || isDragging;
            // MiroFish 风格：r=10，白色描边
            const nodeRadius = isActive ? 12 : 10;
            const strokeWidth = isActive ? 3 : 2;
            const strokeColor = isActive ? '#333' : '#fff';
            
            return (
              <g
                key={char.id}
                className={styles.graphNode}
                onMouseDown={(e) => handleMouseDown(char.id, e)}
                onMouseEnter={() => setHoveredNode(char.id)}
                onMouseLeave={() => setHoveredNode(null)}
                style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
              >
                {/* 主节点圆 - 带白色描边 */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={nodeRadius}
                  fill={color}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  style={{ transition: 'r 0.15s, stroke 0.15s, stroke-width 0.15s' }}
                />
                {/* 节点标签 - 始终显示 */}
                <text
                  x={pos.x + 14}
                  y={pos.y + 4}
                  className={styles.graphNodeLabel}
                  style={{
                    pointerEvents: 'none',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 11,
                    fill: isActive ? '#171717' : '#525252',
                    transition: 'fill 0.15s',
                  }}
                >
                  {char.name.length > 4 ? char.name.slice(0, 4) + '…' : char.name}
                </text>
              </g>
            );
          })}
          </g>
        </svg>

        {/* Tooltip - 右上角详情面板 */}
        {(hoveredChar || hoveredRelData) && (
          <div className={styles.graphTooltip}>
            {hoveredChar && (
              <>
                <div className={styles.tooltipTitle}>{hoveredChar.name}</div>
                {hoveredChar.aliases && hoveredChar.aliases.length > 0 && (
                  <div className={styles.tooltipAlias}>又名: {hoveredChar.aliases.join('、')}</div>
                )}
                <div className={styles.tooltipDesc}>{hoveredChar.description}</div>
              </>
            )}
            {hoveredRelData && !hoveredChar && (
              <>
                <div className={styles.tooltipTitle}>
                  {characters.find((c) => c.id === hoveredRelData.from)?.name || hoveredRelData.from}
                  {' → '}
                  {characters.find((c) => c.id === hoveredRelData.to)?.name || hoveredRelData.to}
                </div>
                <div className={styles.tooltipDesc}>关系: {hoveredRelData.type}</div>
                {hoveredRelData.description && (
                  <div className={styles.tooltipDesc}>{hoveredRelData.description}</div>
                )}
              </>
            )}
          </div>
        )}
        
        {/* 图例 - 左下角 */}
        <div className={styles.graphLegend}>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#FF6B35' }} />
            主角
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#C5283D' }} />
            反派
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#004E89' }} />
            配角
          </span>
          <span className={styles.legendHint}>拖拽调整</span>
        </div>
      </div>
    </div>
  );
}

// ==================== 预览分段组件 ====================

interface Subtitle { text: string; start: number; end: number; }
interface TtsData { status: TtsStatus; path?: string; subtitles?: Subtitle[]; error?: string; }
type TtsStatus = 'idle' | 'loading' | 'done' | 'playing' | 'error';

function PreviewSections({ content, sessionId, chapterIdx, initialTts }: {
  content: string;
  sessionId?: string;
  chapterIdx?: number;
  initialTts?: Record<string, string>;
}) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const [ttsMap, setTtsMap] = useState<Record<number, TtsData>>(() => {
    if (!initialTts) return {};
    const restored: Record<number, TtsData> = {};
    for (const [key, value] of Object.entries(initialTts)) {
      const parts = key.split(':');
      if (parts.length === 2 && parseInt(parts[0]) === chapterIdx) {
        const si = parseInt(parts[1]);
        try {
          const p = JSON.parse(value);
          restored[si] = { status: 'done', path: p.audioPath, subtitles: p.subtitles };
        } catch {
          restored[si] = { status: 'done', path: value };
        }
      }
    }
    return restored;
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [activeSubIdx, setActiveSubIdx] = useState(-1);
  const subtitleRefs = useRef<Record<number, HTMLSpanElement | null>>({});

  const handleTts = useCallback(async (idx: number, title: string, body: string) => {
    setTtsMap((prev) => ({ ...prev, [idx]: { status: 'loading' } }));
    try {
      const episodeKey = `${chapterIdx}:${idx}`;
      const res = await fetch('/api/tts/episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: body, title, speed: 1.3, sessionId, episodeKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTtsMap((prev) => ({
        ...prev,
        [idx]: { status: 'done', path: data.audioPath, subtitles: data.subtitles || [] },
      }));
    } catch (err) {
      setTtsMap((prev) => ({
        ...prev,
        [idx]: { status: 'error', error: err instanceof Error ? err.message : '合成失败' },
      }));
    }
  }, [sessionId, chapterIdx]);

  const handlePlay = useCallback((idx: number, audioPath: string) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingIdx === idx) { setPlayingIdx(null); setActiveSubIdx(-1); return; }

    setOpenIdx(idx);
    const audio = new Audio(`/api/read/output?path=${encodeURIComponent(audioPath)}&raw=1`);
    const subs = ttsMap[idx]?.subtitles || [];

    if (subs.length > 0) {
      audio.ontimeupdate = () => {
        const t = audio.currentTime;
        let found = -1;
        for (let i = 0; i < subs.length; i++) {
          if (t >= subs[i].start && t < subs[i].end) { found = i; break; }
        }
        setActiveSubIdx(found);
        if (found >= 0 && subtitleRefs.current[found]) {
          subtitleRefs.current[found]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      };
    }

    audio.onended = () => { setPlayingIdx(null); setActiveSubIdx(-1); };
    audio.onerror = () => { setPlayingIdx(null); setActiveSubIdx(-1); };
    audio.play();
    audioRef.current = audio;
    setPlayingIdx(idx);
  }, [playingIdx, ttsMap]);

  if (!content || content === '未找到该章节内容' || content === '加载失败') {
    return <div className={styles.previewLoading}>{content}</div>;
  }

  // 按 ### 拆分成各个回
  const sections: { title: string; body: string }[] = [];
  const parts = content.split(/^###\s+/m);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const firstLine = trimmed.indexOf('\n');
    if (firstLine > -1) {
      sections.push({
        title: trimmed.slice(0, firstLine).trim(),
        body: trimmed.slice(firstLine + 1).trim(),
      });
    } else {
      sections.push({ title: trimmed, body: '' });
    }
  }

  if (sections.length <= 1) {
    return <pre className={styles.previewText}>{content}</pre>;
  }

  return (
    <div className={styles.sectionList}>
      {sections.map((sec, i) => {
        if (sec.title.startsWith('## ') || (!sec.body && i === 0)) return null;

        const isOpen = openIdx === i;
        const tts = ttsMap[i];

        return (
          <div key={i} className={styles.sectionItem}>
            <div className={styles.sectionHeader}>
              <button
                className={styles.sectionTitleBtn}
                onClick={() => setOpenIdx(isOpen ? null : i)}
              >
                <span className={styles.sectionTitle}>{sec.title}</span>
                <span className={styles.sectionToggle}>{isOpen ? '−' : '+'}</span>
              </button>
              <div className={styles.sectionActions}>
                {(!tts || tts.status === 'idle') && (
                  <button
                    className={styles.ttsBtn}
                    onClick={() => handleTts(i, sec.title, sec.body)}
                    title="生成语音"
                  >
                    <SpeakerIcon />
                  </button>
                )}
                {tts?.status === 'loading' && (
                  <div className={styles.ttsBtnLoading}>
                    <div className={styles.spinnerSmall} />
                  </div>
                )}
                {tts?.status === 'done' && tts.path && (
                  <>
                    <button
                      className={`${styles.ttsBtn} ${playingIdx === i ? styles.ttsBtnPlaying : ''}`}
                      onClick={() => handlePlay(i, tts.path!)}
                      title={playingIdx === i ? '停止' : '播放'}
                    >
                      {playingIdx === i ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                    </button>
                    <a
                      className={styles.ttsBtn}
                      href={`/api/read/output?path=${encodeURIComponent(tts.path)}&raw=1`}
                      download={`${sec.title}.mp3`}
                      title="下载音频"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </a>
                  </>
                )}
                {tts?.status === 'error' && (
                  <button
                    className={styles.ttsBtnError}
                    onClick={() => handleTts(i, sec.title, sec.body)}
                    title={tts.error}
                  >
                    重试
                  </button>
                )}
              </div>
            </div>
            {isOpen && (
              playingIdx === i && tts?.subtitles && tts.subtitles.length > 0 ? (
                <div className={styles.subtitlePanel}>
                  {tts.subtitles.map((sub, si) => (
                    <span
                      key={si}
                      ref={(el) => { subtitleRefs.current[si] = el; }}
                      className={`${styles.subtitleLine} ${activeSubIdx === si ? styles.subtitleActive : ''}`}
                    >
                      {sub.text}
                    </span>
                  ))}
                </div>
              ) : (
                <pre className={styles.sectionBody}>{sec.body}</pre>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ==================== 主组件 ====================

export default function Home() {
  const [status, setStatus] = useState<Status>('idle');
  const [chapters, setChapters] = useState<ChapterInfo[]>([]);
  const [session, setSession] = useState<SessionData | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // 历史记录
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // 章节预览
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sessionTts, setSessionTts] = useState<Record<string, string>>({});

  // 实时生成内容（正在生成的章节累积内容）
  const [liveContents, setLiveContents] = useState<Record<number, string>>({});

  // 当 liveContents 更新时，自动同步到预览面板（如果正在预览 active 章节）
  useEffect(() => {
    if (previewIndex !== null && chapters[previewIndex]?.status === 'active' && liveContents[previewIndex] !== undefined) {
      setPreviewContent(liveContents[previewIndex]);
    }
  }, [liveContents, previewIndex, chapters]);

  // 知识图谱
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraph | null>(null);

  // 实时日志
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [initStage, setInitStage] = useState('');
  const [initToolCount, setInitToolCount] = useState(0);
  const logIdRef = useRef(0);
  const logEndRef = useRef<HTMLDivElement>(null);

  const pauseRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载历史记录
  useEffect(() => {
    fetch('/api/read/sessions')
      .then((r) => r.json())
      .then((data) => setHistory(data.sessions || []))
      .catch(() => {});
  }, [status]); // status 变化时刷新（上传完成、生成完成等）

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'info') => {
    logIdRef.current++;
    setLogs((prev) => {
      const next = [...prev, { id: logIdRef.current, text, type }];
      return next.length > 50 ? next.slice(-50) : next; // 只保留最近 50 条
    });
  }, []);

  // ==================== 上传（SSE） ====================

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'txt', 'md'].includes(ext || '')) {
      setError('请上传 PDF、TXT 或 MD 文件');
      return;
    }

    setStatus('uploading');
    setError(null);
    setLogs([]);
    setInitStage('正在上传...');
    setInitToolCount(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/read/init', { method: 'POST', body: formData });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error);
      }

      // SSE 解析
      await readSSE(res, (event) => {
        const type = event.type as string;

        if (type === 'stage') {
          const msg = event.message as string;
          setInitStage(msg || '');
          if (msg) addLog(msg, 'stage');
        }

        if (type === 'log') {
          const toolNum = event.tool as number;
          const action = event.action as string;
          setInitToolCount(toolNum);
          addLog(`#${toolNum} ${action}`, 'tool');
        }

        if (type === 'log_detail') {
          addLog(event.message as string, 'info');
        }

        if (type === 'log_result') {
          addLog(`→ ${event.message as string}`, 'result');
        }

        if (type === 'error') {
          throw new Error(event.error as string);
        }

        if (type === 'knowledge_graph') {
          const graphData = event.data as KnowledgeGraph;
          setKnowledgeGraph(graphData);
          addLog(`知识图谱: ${graphData.characters.length} 人物, ${graphData.relationships.length} 关系`, 'stage');
        }

        // 增量图谱更新（边读边构建）
        if (type === 'graph_update') {
          const update = event.data as { characters?: KGCharacter[]; relationships?: KGRelationship[] };
          setKnowledgeGraph((prev) => {
            const base: KnowledgeGraph = prev || { characters: [], relationships: [], events: [] };
            
            // 合并人物（按 id 去重）
            const existingIds = new Set(base.characters.map(c => c.id));
            const newChars = (update.characters || []).filter(c => c.id && !existingIds.has(c.id));
            
            // 合并关系（按 from+to+type 去重）
            const existingRels = new Set(base.relationships.map(r => `${r.from}-${r.to}-${r.type}`));
            const newRels = (update.relationships || []).filter(r => 
              r.from && r.to && !existingRels.has(`${r.from}-${r.to}-${r.type}`)
            );
            
            if (newChars.length === 0 && newRels.length === 0) {
              return prev;
            }
            
            return {
              ...base,
              characters: [...base.characters, ...newChars],
              relationships: [...base.relationships, ...newRels],
            };
          });
        }

        if (type === 'done') {
          setSession({
            sessionId: event.sessionId as string,
            title: event.title as string,
            totalChars: event.totalChars as number,
            outputPath: event.outputPath as string,
          });

          const chs = event.chapters as { index: number; title: string; charCount: number }[];
          setChapters(chs.map((ch) => ({ ...ch, status: 'pending' as const })));
          setStatus('ready');
          setInitStage('');
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
      setStatus('idle');
      setInitStage('');
    }
  }, [addLog]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // ==================== 逐章处理 ====================

  const processLoop = useCallback(
    async (sessionId: string, startIndex: number) => {
      setStatus('generating');
      pauseRef.current = false;

      for (let i = startIndex; i < chapters.length; i++) {
        if (pauseRef.current) {
          setStatus('paused');
          return;
        }

        setCurrentIndex(i);

        // 清空该章的实时内容，自动打开预览
        setLiveContents((prev) => ({ ...prev, [i]: '' }));
        setPreviewIndex(i);
        setPreviewContent('');

        setChapters((prev) =>
          prev.map((ch, idx) => (idx === i ? { ...ch, status: 'active' as const } : ch))
        );

        try {
          await fetchSSE('/api/read/chapter', { sessionId, chapterIndex: i }, (event) => {
            const type = event.type as string;

            if (type === 'segment_start') {
              setChapters((prev) =>
                prev.map((ch, idx) =>
                  idx === i
                    ? { ...ch, segmentsTotal: (event.totalSegments as number) || ch.segmentsTotal }
                    : ch
                )
              );
            }

            if (type === 'segment_done') {
              setChapters((prev) =>
                prev.map((ch, idx) =>
                  idx === i
                    ? {
                        ...ch,
                        segmentsDone: (ch.segmentsDone || 0) + 1,
                        segmentsTotal: (event.totalSegments as number) || ch.segmentsTotal,
                      }
                    : ch
                )
              );

              // 累积实时内容
              if (event.segmentContent) {
                setLiveContents((prev) => ({
                  ...prev,
                  [i]: (prev[i] || '') + (prev[i] ? '\n\n' : '') + (event.segmentContent as string),
                }));
              }
            }

            if (type === 'chapter_done') {
              setChapters((prev) =>
                prev.map((ch, idx) =>
                  idx === i
                    ? { ...ch, status: 'done' as const, outputChars: event.charCount as number }
                    : ch
                )
              );
            }

            if (type === 'chapter_error') {
              setChapters((prev) =>
                prev.map((ch, idx) =>
                  idx === i ? { ...ch, status: 'error' as const, error: event.error as string } : ch
                )
              );
            }
          });
        } catch (err) {
          setChapters((prev) =>
            prev.map((ch, idx) =>
              idx === i
                ? { ...ch, status: 'error' as const, error: err instanceof Error ? err.message : '未知错误' }
                : ch
            )
          );
        }
      }

      setStatus('complete');
    },
    [chapters.length]
  );

  const handleStart = useCallback(() => {
    if (!session) return;
    setLogs([]);
    // 从第一个未完成的章节开始，支持断点续生成
    const startIdx = chapters.findIndex((ch) => ch.status !== 'done');
    processLoop(session.sessionId, startIdx >= 0 ? startIdx : 0);
  }, [session, chapters, processLoop]);

  const handlePause = useCallback(() => {
    pauseRef.current = true;
  }, []);

  const handleResume = useCallback(() => {
    if (!session) return;
    const nextIndex = chapters.findIndex((ch) => ch.status === 'pending' || ch.status === 'error');
    if (nextIndex >= 0) {
      processLoop(session.sessionId, nextIndex);
    }
  }, [session, chapters, processLoop]);

  // ==================== 恢复历史会话 ====================

  const handleRestore = useCallback(async (item: HistoryItem) => {
    try {
      // 从 API 获取完整 session 数据（chapters 信息）
      const res = await fetch('/api/read/sessions?id=' + item.id);
      const data = await res.json();

      if (!data.session) {
        // fallback: 用摘要信息恢复
        setSession({
          sessionId: item.id,
          title: item.title,
          totalChars: item.totalChars,
          outputPath: item.outputPath,
        });

        // 构造章节列表
        const chs: ChapterInfo[] = [];
        for (let i = 0; i < item.chapterCount; i++) {
          chs.push({
            index: i,
            title: `第${i + 1}章`,
            charCount: 0,
            status: i < item.completedCount ? 'done' : 'pending',
          });
        }
        setChapters(chs);
      } else {
        const s = data.session;
        setSession({
          sessionId: s.id,
          title: s.title,
          totalChars: s.content?.length || item.totalChars,
          outputPath: s.outputPath,
        });

        setChapters(
          (s.chapters || []).map((ch: { title: string; content: string }, i: number) => ({
            index: i,
            title: ch.title,
            charCount: ch.content?.length || 0,
            status: (s.completedChapters || []).includes(i) ? 'done' : 'pending',
          }))
        );
      }

      // 恢复 TTS 结果
      if (data.session?.ttsResults) {
        setSessionTts(data.session.ttsResults);
      } else {
        setSessionTts({});
      }

      setLogs([]);
      setStatus(item.completedCount >= item.chapterCount ? 'complete' : 'ready');
    } catch {
      setError('恢复会话失败');
    }
  }, []);

  const handleDeleteHistory = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`/api/read/sessions?id=${id}`, { method: 'DELETE' });
    setHistory((prev) => prev.filter((h) => h.id !== id));
  }, []);

  // ==================== 查看章节 ====================

  const handlePreview = useCallback(async (chapterIdx: number) => {
    if (previewIndex === chapterIdx) {
      setPreviewIndex(null);
      return;
    }

    if (!session) return;
    const ch = chapters[chapterIdx];

    // 正在生成的章节：直接用 liveContents（不需要从文件加载）
    if (ch?.status === 'active') {
      setPreviewIndex(chapterIdx);
      setPreviewContent(liveContents[chapterIdx] || '');
      setPreviewLoading(false);
      return;
    }

    setPreviewIndex(chapterIdx);
    setPreviewLoading(true);
    setPreviewContent('');

    try {
      const res = await fetch(`/api/read/output?path=${encodeURIComponent(session.outputPath)}`);
      const data = await res.json();
      if (!data.content) {
        setPreviewContent('暂无内容');
        return;
      }

      // 按 ## 章节标题 切分，找到对应章节
      const chapterTitle = ch?.title || '';
      const escaped = chapterTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 不用 \b，中文字符不支持词边界
      const pattern = new RegExp(`## ${escaped}`);
      const match = data.content.match(pattern);

      if (match && match.index !== undefined) {
        const start = match.index;
        // 找下一个 ## 或 --- 分割线或文件末尾
        const nextChapter = data.content.indexOf('\n## ', start + 1);
        const nextSep = data.content.indexOf('\n---', start + 10);
        let end = data.content.length;
        if (nextChapter > -1) end = Math.min(end, nextChapter);
        if (nextSep > -1 && nextSep < end) end = nextSep;
        setPreviewContent(data.content.slice(start, end).trim());
      } else {
        setPreviewContent('未找到该章节内容');
      }
    } catch {
      setPreviewContent('加载失败');
    } finally {
      setPreviewLoading(false);
    }
  }, [previewIndex, session, chapters, liveContents]);

  // ==================== 统计 ====================

  const doneCount = chapters.filter((ch) => ch.status === 'done').length;
  const totalOutputChars = chapters.reduce((sum, ch) => sum + (ch.outputChars || 0), 0);

  // ==================== 渲染 ====================

  const hasSession = session && status !== 'idle' && status !== 'uploading';

  return (
    <main className={`${styles.container} ${!hasSession ? styles.containerIdle : ''}`}>
      {/* 头部 */}
      <header className={hasSession ? styles.headerCompact : styles.header}>
        <h1 className={styles.title}>评书工坊</h1>
        <p className={styles.subtitle}>AI 评书改编 · TTS 语音合成</p>
        {hasSession && (
          <div className={styles.headerRight}>
            <span className={styles.fileStats}>
              {session.title} · {(session.totalChars / 10000).toFixed(1)} 万字 · {chapters.length} 章
            </span>
            <span className={styles.progressStats}>
              <strong>{doneCount}</strong> / {chapters.length}
              {totalOutputChars > 0 && <> · {(totalOutputChars / 10000).toFixed(1)} 万字</>}
            </span>

            {status === 'ready' && (
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleStart}>
                <PlayIcon /> {doneCount > 0 ? '继续生成' : '开始'}
              </button>
            )}
            {status === 'generating' && (
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handlePause}>
                <PauseIcon /> 暂停
              </button>
            )}
            {status === 'paused' && (
              <button className={`${styles.btn} ${styles.btnGold}`} onClick={handleResume}>
                <PlayIcon /> 继续
              </button>
            )}
          </div>
        )}
      </header>

      {/* 上传区 */}
      {status === 'idle' && (
        <>
          <div
            className={`${styles.uploadZone} ${dragging ? styles.uploadZoneDragging : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <UploadIcon />
            <p className={styles.uploadText}>拖拽文件到此处，或点击上传</p>
            <p className={styles.uploadHint}>支持 PDF / TXT / MD</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md"
            className={styles.uploadInput}
            onChange={onFileChange}
          />
          {error && <div className={styles.errorMsg}>{error}</div>}

          {/* 历史记录 */}
          {history.length > 0 && (
            <div className={styles.historySection}>
              <h2 className={styles.historyTitle}>历史记录</h2>
              <div className={styles.historyList}>
                {history.map((item) => {
                  const isComplete = item.completedCount >= item.chapterCount;
                  const progress = item.chapterCount > 0
                    ? Math.round((item.completedCount / item.chapterCount) * 100)
                    : 0;

                  return (
                    <div
                      key={item.id}
                      className={styles.historyItem}
                      onClick={() => handleRestore(item)}
                    >
                      <div className={styles.historyItemMain}>
                        <div className={styles.historyItemTitle}>{item.title}</div>
                        <div className={styles.historyItemMeta}>
                          {(item.totalChars / 10000).toFixed(1)} 万字 · {item.chapterCount} 章
                          {' · '}
                          {isComplete ? (
                            <span className={styles.historyComplete}>已完成</span>
                          ) : (
                            <span className={styles.historyProgress}>{progress}%（{item.completedCount}/{item.chapterCount}）</span>
                          )}
                        </div>
                        <div className={styles.historyItemTime}>
                          {new Date(item.createdAt).toLocaleString('zh-CN')}
                        </div>
                      </div>
                      <button
                        className={styles.historyDeleteBtn}
                        onClick={(e) => handleDeleteHistory(item.id, e)}
                        title="删除"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* 初始化中（带实时日志 + 知识图谱） */}
      {status === 'uploading' && (
        <div className={styles.initPanel}>
          <div className={styles.initHeader}>
            <div className={styles.spinner} />
            <div>
              <div className={styles.initStage}>{initStage}</div>
              {initToolCount > 0 && (
                <div className={styles.initMeta}>
                  <BookIcon /> AI 已执行 {initToolCount} 次工具调用
                </div>
              )}
            </div>
          </div>
          <div className={styles.initContent}>
            <div className={styles.logPanel}>
              {logs.map((log) => (
                <div
                  key={log.id}
                  className={`${styles.logLine} ${
                    log.type === 'tool' ? styles.logTool :
                    log.type === 'result' ? styles.logResult :
                    log.type === 'stage' ? styles.logStage : ''
                  }`}
                >
                  {log.text}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
            <KnowledgeGraphPanel graph={knowledgeGraph} isLoading={!knowledgeGraph && initToolCount > 5} />
          </div>
        </div>
      )}

      {/* 就绪 / 生成中 / 暂停 / 完成 — 左右布局 */}
      {session && status !== 'idle' && status !== 'uploading' && (
        <>
          {/* 文件信息 */}
          <div className={styles.fileInfo}>
            <span className={styles.fileName}>{session.title}</span>
            <span className={styles.fileStats}>
              {(session.totalChars / 10000).toFixed(1)} 万字 · {chapters.length} 章
            </span>
          </div>

          {/* 操作栏 */}
          <div className={styles.actionBar}>
            {status === 'ready' && (
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleStart}>
                <PlayIcon />
                {doneCount > 0 ? '继续生成' : '开始生成'}
              </button>
            )}

            {status === 'generating' && (
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handlePause}>
                <PauseIcon />
                暂停
              </button>
            )}

            {status === 'paused' && (
              <button className={`${styles.btn} ${styles.btnGold}`} onClick={handleResume}>
                <PlayIcon />
                继续
              </button>
            )}

            {status === 'complete' && (
              <span className={styles.progressStats}>全部完成</span>
            )}

            {(status === 'generating' || status === 'paused' || status === 'complete') && (
              <span className={styles.progressStats}>
                <strong>{doneCount}</strong> / {chapters.length} 章
                {totalOutputChars > 0 && <> · {(totalOutputChars / 10000).toFixed(1)} 万字</>}
              </span>
            )}
          </div>

          {/* 左右双栏 */}
          <div className={styles.splitLayout}>
            {/* 左侧：章节列表 */}
            <div className={styles.splitLeft}>
              <div className={styles.timeline}>
                {chapters.map((ch, idx) => {
                  const isActive = ch.status === 'active';
                  const isDone = ch.status === 'done';
                  const isError = ch.status === 'error';
                  const isSelected = previewIndex === idx;

                  let dotClass = styles.chapterDot;
                  if (isActive) dotClass += ` ${styles.chapterDotActive}`;
                  if (isDone) dotClass += ` ${styles.chapterDotDone}`;
                  if (isError) dotClass += ` ${styles.chapterDotError}`;

                  return (
                    <div
                      key={idx}
                      className={`${styles.chapterItem} ${isActive ? styles.chapterActive : ''} ${isSelected ? styles.chapterSelected : ''}`}
                      onClick={() => (isDone || isActive) && handlePreview(idx)}
                      style={{ cursor: (isDone || isActive) ? 'pointer' : 'default' }}
                    >
                      <div className={dotClass}>
                        {isDone && <CheckIcon className={styles.chapterCheck} />}
                      </div>

                      <div>
                        <div className={styles.chapterTitle}>{ch.title}</div>
                        <div className={styles.chapterMeta}>
                          {ch.charCount.toLocaleString()} 字
                          {isDone && ch.outputChars && <> → {ch.outputChars.toLocaleString()} 字</>}
                          {isError && <> · 失败</>}
                        </div>
                      </div>

                      {isActive && ch.segmentsTotal && ch.segmentsTotal > 0 && (
                        <div className={styles.segmentProgress}>
                          {Array.from({ length: ch.segmentsTotal }, (_, si) => {
                            let barClass = styles.segmentBar;
                            if (si < (ch.segmentsDone || 0)) barClass += ` ${styles.segmentBarDone}`;
                            else if (si === (ch.segmentsDone || 0)) barClass += ` ${styles.segmentBarActive}`;
                            return <div key={si} className={barClass} />;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 完成横幅 */}
              {status === 'complete' && session.outputPath && (
                <div className={styles.completeBanner}>
                  <div className={styles.completeTitle}>生成完成</div>
                  <code className={styles.completePath}>{session.outputPath}</code>
                </div>
              )}
            </div>

            {/* 右侧：预览 */}
            <div className={styles.splitRight}>
              {previewIndex !== null ? (
                <div className={styles.readerPanel}>
                  <div className={styles.readerHeader}>
                    <span className={styles.readerTitle}>
                      {chapters[previewIndex]?.title}
                      {chapters[previewIndex]?.status === 'active' && (
                        <span className={styles.liveTag}>生成中</span>
                      )}
                    </span>
                    <button className={styles.previewBtn} onClick={() => setPreviewIndex(null)}>关闭</button>
                  </div>
                  <div className={styles.readerBody}>
                    {previewLoading ? (
                      <div className={styles.previewLoading}>加载中...</div>
                    ) : previewContent ? (
                      <PreviewSections
                        content={previewContent}
                        sessionId={session?.sessionId}
                        chapterIdx={previewIndex}
                        initialTts={sessionTts}
                      />
                    ) : chapters[previewIndex]?.status === 'active' ? (
                      <div className={styles.previewLoading}>
                        <div className={styles.spinner} />
                        等待第一回生成...
                      </div>
                    ) : (
                      <div className={styles.previewLoading}>暂无内容</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={styles.readerEmpty}>
                  <p>点击左侧已完成的章节查看内容</p>
                </div>
              )}
            </div>
      </div>
        </>
      )}
    </main>
  );
}
