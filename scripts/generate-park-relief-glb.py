#!/usr/bin/env python3
"""Build a compact glTF 2.0 relief mesh from the park aerial photograph.

This intentionally creates a subtle 2.5D height field instead of pretending that
a single oblique photograph contains the hidden sides of every building. The
original JPEG is embedded as the material texture so the browser only requests
one self-contained GLB.
"""

from __future__ import annotations

import argparse
import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


GLTF_JSON = 0x4E4F534A
GLTF_BIN = 0x004E4942


def align4(data: bytes, padding: bytes = b"\x00") -> bytes:
    return data + padding * ((-len(data)) % 4)


def append_view(blob: bytearray, payload: bytes, target: int | None = None) -> dict:
    while len(blob) % 4:
        blob.append(0)
    offset = len(blob)
    blob.extend(payload)
    view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
    if target is not None:
        view["target"] = target
    return view


def build_height_field(image: Image.Image, cols: int, rows: int) -> np.ndarray:
    rgb = np.asarray(image.resize((cols, rows), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
    smooth = np.asarray(
        image.filter(ImageFilter.GaussianBlur(radius=18)).resize((cols, rows), Image.Resampling.LANCZOS),
        dtype=np.float32,
    ) / 255.0

    luma = rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722
    smooth_luma = smooth[..., 0] * 0.2126 + smooth[..., 1] * 0.7152 + smooth[..., 2] * 0.0722
    saturation = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    green_dominance = np.clip(rgb[..., 1] - (rgb[..., 0] + rgb[..., 2]) * 0.5, 0.0, 0.35) / 0.35

    bright_roof = np.clip((luma - 0.42) / 0.42, 0.0, 1.0) ** 1.7
    neutral_surface = np.clip((0.42 - saturation) / 0.42, 0.0, 1.0)
    local_structure = np.clip((luma - smooth_luma) * 3.3, 0.0, 1.0)
    roof_signal = bright_roof * (0.36 + neutral_surface * 0.64) * (1.0 - green_dominance * 0.78)

    height = 0.012 + roof_signal * 0.115 + local_structure * 0.035
    height_image = Image.fromarray(np.uint8(np.clip(height / 0.162, 0.0, 1.0) * 255), mode="L")
    height = np.asarray(height_image.filter(ImageFilter.GaussianBlur(radius=1.15)), dtype=np.float32) / 255.0 * 0.162

    # Sink the outer border so the relief has a clean, thin silhouette at camera angles.
    yy, xx = np.mgrid[0:rows, 0:cols]
    edge_distance = np.minimum.reduce((xx, cols - 1 - xx, yy, rows - 1 - yy)).astype(np.float32)
    edge_fade = np.clip(edge_distance / 5.0, 0.0, 1.0)
    return height * edge_fade


def build_glb(source: Path, output: Path, cols: int, rows: int) -> tuple[int, int, int]:
    image = Image.open(source).convert("RGB")
    aspect = image.width / image.height
    heights = build_height_field(image, cols, rows)

    positions = np.empty((rows, cols, 3), dtype="<f4")
    texcoords = np.empty((rows, cols, 2), dtype="<f4")
    for row in range(rows):
        v = row / (rows - 1)
        positions[row, :, 0] = np.linspace(-aspect, aspect, cols, dtype=np.float32)
        positions[row, :, 1] = 1.0 - 2.0 * v
        positions[row, :, 2] = heights[row]
        texcoords[row, :, 0] = np.linspace(0.0, 1.0, cols, dtype=np.float32)
        # glTF images use the upper-left texel origin; GLTFLoader keeps flipY disabled.
        texcoords[row, :, 1] = v

    dx = (2.0 * aspect) / (cols - 1)
    dy = 2.0 / (rows - 1)
    dz_dy, dz_dx = np.gradient(heights, dy, dx)
    normals = np.stack((-dz_dx, dz_dy, np.ones_like(heights)), axis=2).astype("<f4")
    normals /= np.linalg.norm(normals, axis=2, keepdims=True)

    triangles: list[tuple[int, int, int]] = []
    for row in range(rows - 1):
        for col in range(cols - 1):
            a = row * cols + col
            b = a + 1
            c = a + cols
            d = c + 1
            triangles.extend(((a, c, b), (b, c, d)))
    indices = np.asarray(triangles, dtype="<u2").reshape(-1)

    # Re-encode at a controlled quality so the GLB is deterministic and web-sized.
    texture_stream = io.BytesIO()
    image.save(texture_stream, format="JPEG", quality=84, optimize=True, progressive=True)
    texture = texture_stream.getvalue()

    binary = bytearray()
    views = [
        append_view(binary, positions.reshape(-1, 3).tobytes(), 34962),
        append_view(binary, normals.reshape(-1, 3).tobytes(), 34962),
        append_view(binary, texcoords.reshape(-1, 2).tobytes(), 34962),
        append_view(binary, indices.tobytes(), 34963),
        append_view(binary, texture),
    ]

    position_min = positions.reshape(-1, 3).min(axis=0).tolist()
    position_max = positions.reshape(-1, 3).max(axis=0).tolist()
    vertex_count = rows * cols
    triangle_count = len(triangles)
    document = {
        "asset": {"version": "2.0", "generator": "Smart Control lightweight aerial relief generator"},
        "scene": 0,
        "scenes": [{"name": "Jinhu Smart Park", "nodes": [0]}],
        "nodes": [{"name": "Park aerial relief", "mesh": 0}],
        "meshes": [{
            "name": "Low-poly aerial terrain",
            "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0}],
            "extras": {"source": source.name, "vertices": vertex_count, "triangles": triangle_count, "kind": "single-image-2.5d-relief"},
        }],
        "materials": [{
            "name": "Aerial photograph",
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicFactor": 0.0,
                "roughnessFactor": 0.94,
            },
            "doubleSided": True,
        }],
        "textures": [{"sampler": 0, "source": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"name": "Park aerial texture", "mimeType": "image/jpeg", "bufferView": 4}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": vertex_count, "type": "VEC3", "min": position_min, "max": position_max},
            {"bufferView": 1, "componentType": 5126, "count": vertex_count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": vertex_count, "type": "VEC2", "min": [0.0, 0.0], "max": [1.0, 1.0]},
            {"bufferView": 3, "componentType": 5123, "count": indices.size, "type": "SCALAR", "min": [0], "max": [vertex_count - 1]},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }

    json_chunk = align4(json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), b" ")
    bin_chunk = align4(bytes(binary))
    total_length = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    payload = (
        struct.pack("<4sII", b"glTF", 2, total_length)
        + struct.pack("<II", len(json_chunk), GLTF_JSON)
        + json_chunk
        + struct.pack("<II", len(bin_chunk), GLTF_BIN)
        + bin_chunk
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    return vertex_count, triangle_count, len(payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cols", type=int, default=96)
    parser.add_argument("--rows", type=int, default=68)
    args = parser.parse_args()
    if args.cols * args.rows >= 65536:
        raise SystemExit("Grid must fit uint16 indices")
    vertices, triangles, size = build_glb(args.source, args.output, args.cols, args.rows)
    print(f"generated {args.output}: {vertices} vertices, {triangles} triangles, {size / 1024:.1f} KiB")


if __name__ == "__main__":
    main()
