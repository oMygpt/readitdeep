/**
 * Highlight Utilities
 * 
 * 用户颜色分配机制和高亮相关工具函数
 */

// 高亮颜色调色板 (柔和且可区分的颜色)
export const HIGHLIGHT_COLORS = [
    '#FFE082', // 金黄
    '#FF8A80', // 粉红
    '#82B1FF', // 天蓝
    '#B9F6CA', // 薄荷
    '#B388FF', // 紫色
    '#FF80AB', // 玫红
    '#84FFFF', // 青色
    '#FFAB40', // 橙色
    '#EA80FC', // 淡紫
    '#CCFF90', // 黄绿
] as const;

/**
 * 根据用户 ID 生成一致的颜色
 * 使用简单哈希确保同一用户始终获得相同颜色
 */
export function getUserHighlightColor(userId: string): string {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
        const char = userId.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    const index = Math.abs(hash) % HIGHLIGHT_COLORS.length;
    return HIGHLIGHT_COLORS[index];
}

/**
 * 获取颜色对应的半透明背景色 (用于高亮渲染)
 */
export function getHighlightBackgroundColor(color: string, opacity: number = 0.3): string {
    // 解析 hex 颜色
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * 获取颜色对应的边框色 (稍微深一点)
 */
export function getHighlightBorderColor(color: string): string {
    return getHighlightBackgroundColor(color, 0.6);
}

/**
 * 获取高亮的 CSS 样式
 */
export function getHighlightStyle(color: string, isHovered: boolean = false): React.CSSProperties {
    return {
        backgroundColor: getHighlightBackgroundColor(color, isHovered ? 0.5 : 0.3),
        borderRadius: '2px',
        padding: '0 2px',
        cursor: 'pointer',
        transition: 'background-color 0.2s ease',
    };
}

/**
 * 颜色名称映射 (用于显示)
 */
export const COLOR_NAMES: Record<string, string> = {
    '#FFE082': '金黄',
    '#FF8A80': '粉红',
    '#82B1FF': '天蓝',
    '#B9F6CA': '薄荷',
    '#B388FF': '紫色',
    '#FF80AB': '玫红',
    '#84FFFF': '青色',
    '#FFAB40': '橙色',
    '#EA80FC': '淡紫',
    '#CCFF90': '黄绿',
};

export function getColorName(color: string): string {
    return COLOR_NAMES[color] || '自定义';
}
