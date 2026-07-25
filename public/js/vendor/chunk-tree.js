// ESM wrapper for the UMD/IIFE chunk-tree global
// The UMD file (public/chunk-tree.js) assigns to window.ChunkTree.
// This module re-exports it so ESM consumers can import it.
export const ChunkTree = globalThis.ChunkTree;
export default globalThis.ChunkTree;
