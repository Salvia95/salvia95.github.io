/**
 * Optimized client-side Mermaid initialization script
 * 
 * This script handles Mermaid diagram rendering with:
 * - Lazy loading using Intersection Observer
 * - Diagram caching to prevent re-rendering on theme changes
 * - Progressive loading with skeleton states
 * - Performance optimizations
 */

import { initializeMermaidOnLoad, handleThemeChange } from '../utils/mermaid';

// Initialize Mermaid when DOM is ready
initializeMermaidOnLoad();

// Make theme change handler globally available
if (typeof window !== 'undefined') {
  (window as any).handleMermaidThemeChange = handleThemeChange;

  // 다이어그램 색이 블로그 팔레트에서 나오므로, 다크모드 토글뿐 아니라
  // 팔레트 테마 전환(atom→dracula 등)에서도 다시 그려야 한다.
  // changeTheme() 이 CSS 변수를 갱신한 뒤 발행하는 이벤트라 이 시점엔 값이 최신이다.
  // (LocalGraph/GraphModal 이 쓰는 것과 같은 훅)
  window.addEventListener('themechange', handleThemeChange);
}
