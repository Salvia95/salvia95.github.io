import type { Root, Element } from 'hast';
import { visit } from 'unist-util-visit';

/**
 * Rehype plugin to optimize images in markdown content
 * Adds proper loading attributes and other optimizations
 */
export function rehypeOptimizeImages() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName === 'img') {
        const properties = node.properties || {};
        
        // Add loading="lazy" if not already set
        if (!properties.loading) {
          properties.loading = 'lazy';
        }
        
        // Add decoding="async" if not already set
        if (!properties.decoding) {
          properties.decoding = 'async';
        }
        
        // Ensure alt text is present
        if (!properties.alt) {
          properties.alt = '';
        }
      }
    });
  };
}

export default rehypeOptimizeImages;
