import { useEffect, useMemo, useState } from 'react';
import { invalidate } from '@react-three/fiber';
import * as THREE from 'three';
import {
  TEXTURE_TILE_M,
  materialKind,
  swatchById,
  swatchTextureUrl,
  type SurfaceFinish,
} from '@/systems/aesthetic/finishes';

/**
 * A `SurfaceFinish` → a Three.js material, mirroring
 * `Design/Render/MaterialFactory.swift`.
 *
 * The rules are the iPad's, in the iPad's order: resolve the swatch, use its
 * bitmap if there is one, fall back to its average tone if there is not (NOT to
 * white — a textured swatch's own `rgba` is a multiply tint, so using it as a
 * base colour renders flat white, which is the bug that comment in the Swift
 * guards against), then apply the material kind's roughness and metalness, then
 * the glass/metal specialisations, then the tint.
 *
 * Textures are cached per URL because the same oak floor is asked for by the
 * floor, the plan, and every cabinet front, and decoding a 1024² PNG six times
 * is six times too many.
 */

const cache = new Map<string, THREE.Texture>();
const loader = typeof window === 'undefined' ? null : new THREE.TextureLoader();

function load(url: string): THREE.Texture | null {
  if (!loader) return null;
  const hit = cache.get(url);
  if (hit) return hit;
  // The canvas runs `frameloop="demand"`, so a bitmap that arrives after the
  // last paint would sit in memory unseen. Ask for a frame when it lands.
  const texture = loader.load(url, () => invalidate());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(url, texture);
  return texture;
}

/**
 * Load a finish's texture, if it has one. Returns null while loading has not
 * been attempted (server render) or when the swatch is a solid colour.
 */
export function useFinishTexture(finish: SurfaceFinish): THREE.Texture | null {
  const url = swatchTextureUrl(swatchById(finish.swatchId));
  const [texture, setTexture] = useState<THREE.Texture | null>(() => (url ? load(url) : null));

  useEffect(() => {
    setTexture(url ? load(url) : null);
  }, [url]);

  return texture;
}

/**
 * Build the material for a finish covering a surface `spanM` metres across.
 *
 * The repeat is computed from real-world size, not from UV convention: one tile
 * is one metre, as `Room3DBuilder` writes its UVs, so a 4 m wall shows four
 * tiles and a 400 mm door panel shows a slice of one. Without this a texture is
 * stretched to fit whatever it lands on and every surface looks like a
 * different material.
 */
export function useFinishMaterial(
  finish: SurfaceFinish,
  opts: {
    /**
     * Millimetres of surface one UV unit spans. Geometry that writes its UVs in
     * millimetres (the room shell) passes 1; geometry with 0…1 face UVs passes
     * the face's size.
     */
    uvUnitMm?: number;
    side?: THREE.Side;
  } = {},
): THREE.MeshStandardMaterial {
  const texture = useFinishTexture(finish);
  const swatch = swatchById(finish.swatchId);
  const kind = materialKind(finish.kind);
  const uvUnitMm = opts.uvUnitMm ?? 1000;
  const side = opts.side ?? THREE.FrontSide;

  return useMemo(() => {
    const material = new THREE.MeshStandardMaterial({ side });

    // A tinted texture multiplies the texels; a solid swatch (or a missing
    // bitmap) supplies the colour itself.
    if (texture) {
      const map = texture.clone();
      map.needsUpdate = true;
      const repeat = (uvUnitMm / (TEXTURE_TILE_M * 1000)) * finish.textureScale;
      map.repeat.set(repeat, repeat);
      map.center.set(0.5, 0.5);
      map.rotation = finish.rotation;
      material.map = map;
      material.color = new THREE.Color(finish.tint ?? '#ffffff');
    } else {
      material.color = new THREE.Color(finish.tint ?? swatch?.color ?? '#cccccc');
    }

    material.roughness = kind.roughness;
    material.metalness = kind.metalness;

    if (finish.kind === 'glass') {
      material.transparent = true;
      material.opacity = kind.opacity;
      material.metalness = 0;
      material.side = THREE.DoubleSide;
    } else if (finish.kind === 'mirror' || finish.kind === 'metal') {
      material.metalness = 1;
    }

    return material;
    // `texture` identity changes when the bitmap arrives, which is what
    // re-runs this and puts the map on the surface.
  }, [texture, swatch?.color, kind.roughness, kind.metalness, kind.opacity,
      finish.kind, finish.tint, finish.textureScale, finish.rotation, uvUnitMm, side]);
}

/** Dispose a material and its map — call from a layout effect's cleanup. */
export function disposeMaterial(material: THREE.Material): void {
  const standard = material as THREE.MeshStandardMaterial;
  standard.map?.dispose();
  material.dispose();
}
