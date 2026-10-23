// Real MOZU surface finishes (HUE, TOUCH, CLASSIC FABRIC/WOOD, GLOSSY, REAL),
// imported from the official MOZU Surface Selection. Textured finishes ship a
// 768px PBR texture under Resources/Textures; flat finishes are solid colours.
// `avgColor` is the representative tone for the 2D plan. Generated — do not edit.

import Foundation
import simd

enum MozuFinishes {
    private static func c(_ r: Float, _ g: Float, _ b: Float) -> SIMD4<Float> { SIMD4<Float>(r, g, b, 1) }

    static let swatches: [Swatch] = [
        Swatch(id: "mozu_wood_ash_01", name: "Ash 01", category: .wood, textureName: "mozu_wood_ash_01", avgColor: c(0.551, 0.453, 0.390)),
        Swatch(id: "mozu_wood_cherry_01", name: "Cherry 01", category: .wood, textureName: "mozu_wood_cherry_01", avgColor: c(0.850, 0.632, 0.414)),
        Swatch(id: "mozu_wood_oak_01", name: "Oak 01", category: .wood, textureName: "mozu_wood_oak_01", avgColor: c(0.757, 0.632, 0.520)),
        Swatch(id: "mozu_wood_oak_02", name: "Oak 02", category: .wood, textureName: "mozu_wood_oak_02", avgColor: c(0.246, 0.190, 0.180)),
        Swatch(id: "mozu_wood_oak_03", name: "Oak 03", category: .wood, textureName: "mozu_wood_oak_03", avgColor: c(0.847, 0.634, 0.412)),
        Swatch(id: "mozu_wood_oak_04", name: "Oak 04", category: .wood, textureName: "mozu_wood_oak_04", avgColor: c(0.674, 0.552, 0.405)),
        Swatch(id: "mozu_wood_oak_05", name: "Oak 05", category: .wood, textureName: "mozu_wood_oak_05", avgColor: c(0.355, 0.278, 0.235)),
        Swatch(id: "mozu_wood_oak_06", name: "Oak 06", category: .wood, textureName: "mozu_wood_oak_06", avgColor: c(0.711, 0.584, 0.442)),
        Swatch(id: "mozu_wood_oak_07", name: "Oak 07", category: .wood, textureName: "mozu_wood_oak_07", avgColor: c(0.218, 0.218, 0.218)),
        Swatch(id: "mozu_wood_oak_08", name: "Oak 08", category: .wood, textureName: "mozu_wood_oak_08", avgColor: c(0.804, 0.659, 0.501)),
        Swatch(id: "mozu_wood_oak_09", name: "Oak 09", category: .wood, textureName: "mozu_wood_oak_09", avgColor: c(0.538, 0.430, 0.344)),
        Swatch(id: "mozu_wood_walnut_01", name: "Walnut 01", category: .wood, textureName: "mozu_wood_walnut_01", avgColor: c(0.718, 0.600, 0.477)),
        Swatch(id: "mozu_wood_walnut_02", name: "Walnut 02", category: .wood, textureName: "mozu_wood_walnut_02", avgColor: c(0.491, 0.388, 0.324)),
        Swatch(id: "mozu_wood_walnut_03", name: "Walnut 03", category: .wood, textureName: "mozu_wood_walnut_03", avgColor: c(0.461, 0.342, 0.259)),
        Swatch(id: "mozu_wood_wenge_01", name: "Wenge 01", category: .wood, textureName: "mozu_wood_wenge_01", avgColor: c(0.571, 0.513, 0.494)),
        Swatch(id: "mozu_glossy_01", name: "Glossy 01", category: .glossy, textureName: nil, rgba: c(0.928, 0.929, 0.920)),
        Swatch(id: "mozu_glossy_02", name: "Glossy 02", category: .glossy, textureName: nil, rgba: c(0.880, 0.876, 0.866)),
        Swatch(id: "mozu_glossy_03", name: "Glossy 03", category: .glossy, textureName: nil, rgba: c(0.850, 0.820, 0.782)),
        Swatch(id: "mozu_glossy_04", name: "Glossy 04", category: .glossy, textureName: nil, rgba: c(0.344, 0.308, 0.273)),
        Swatch(id: "mozu_glossy_05", name: "Glossy 05", category: .glossy, textureName: nil, rgba: c(0.305, 0.321, 0.333)),
        Swatch(id: "mozu_glossy_6", name: "Glossy 6", category: .glossy, textureName: nil, rgba: c(0.330, 0.216, 0.200)),
        Swatch(id: "mozu_hue_1_1", name: "Hue 1-1", category: .hue, textureName: nil, rgba: c(0.982, 0.968, 0.963)),
        Swatch(id: "mozu_hue_2_1", name: "Hue 2-1", category: .hue, textureName: nil, rgba: c(0.965, 0.933, 0.896)),
        Swatch(id: "mozu_hue_2_4", name: "Hue 2-4", category: .hue, textureName: nil, rgba: c(0.837, 0.785, 0.739)),
        Swatch(id: "mozu_hue_2_5", name: "Hue 2-5", category: .hue, textureName: nil, rgba: c(0.728, 0.666, 0.610)),
        Swatch(id: "mozu_hue_4_1", name: "Hue 4-1", category: .hue, textureName: nil, rgba: c(0.310, 0.310, 0.310)),
        Swatch(id: "mozu_hue_4_2", name: "Hue 4-2", category: .hue, textureName: nil, rgba: c(0.158, 0.158, 0.160)),
        Swatch(id: "mozu_hue_5_1", name: "Hue 5-1", category: .hue, textureName: nil, rgba: c(0.328, 0.179, 0.167)),
        Swatch(id: "mozu_hue_leather_01_01", name: "Hue Leather 01-01", category: .hue, textureName: "mozu_hue_leather_01_01", avgColor: c(0.751, 0.731, 0.707)),
        Swatch(id: "mozu_hue_leather_01_02", name: "Hue Leather 01-02", category: .hue, textureName: "mozu_hue_leather_01_02", avgColor: c(0.364, 0.335, 0.324)),
        Swatch(id: "mozu_hue_metalic_01_02", name: "Hue Metalic 01-02", category: .hue, textureName: nil, rgba: c(0.480, 0.407, 0.323)),
        Swatch(id: "mozu_hue_metalic_1_1", name: "Hue Metalic 1-1", category: .hue, textureName: nil, rgba: c(0.579, 0.471, 0.283)),
        Swatch(id: "mozu_touch_01", name: "Touch 01", category: .touch, textureName: nil, rgba: c(0.880, 0.876, 0.866)),
        Swatch(id: "mozu_touch_02", name: "Touch 02", category: .touch, textureName: nil, rgba: c(0.850, 0.820, 0.782)),
        Swatch(id: "mozu_touch_03", name: "Touch 03", category: .touch, textureName: nil, rgba: c(0.685, 0.634, 0.560)),
        Swatch(id: "mozu_touch_04", name: "Touch 04", category: .touch, textureName: nil, rgba: c(0.344, 0.308, 0.273)),
        Swatch(id: "mozu_touch_05", name: "Touch 05", category: .touch, textureName: nil, rgba: c(0.305, 0.321, 0.333)),
        Swatch(id: "mozu_fabric_01", name: "Fabric 01", category: .fabric, textureName: "mozu_fabric_01", avgColor: c(0.767, 0.755, 0.719)),
        Swatch(id: "mozu_fabric_02", name: "Fabric 02", category: .fabric, textureName: "mozu_fabric_02", avgColor: c(0.791, 0.764, 0.732)),
        Swatch(id: "mozu_fabric_03", name: "Fabric 03", category: .fabric, textureName: "mozu_fabric_03", avgColor: c(0.896, 0.850, 0.788)),
        Swatch(id: "mozu_fabric_04_01", name: "Fabric 04-01", category: .fabric, textureName: "mozu_fabric_04_01", avgColor: c(0.799, 0.787, 0.742)),
        Swatch(id: "mozu_fabric_04_02", name: "Fabric 04-02", category: .fabric, textureName: "mozu_fabric_04_02", avgColor: c(0.626, 0.601, 0.536)),
        Swatch(id: "mozu_fabric_05", name: "Fabric 05", category: .fabric, textureName: "mozu_fabric_05", avgColor: c(0.803, 0.742, 0.683)),
        Swatch(id: "mozu_fabric_06", name: "Fabric 06", category: .fabric, textureName: "mozu_fabric_06", avgColor: c(0.908, 0.867, 0.802)),
        Swatch(id: "mozu_real_01", name: "Real 01", category: .real, textureName: "mozu_real_01", avgColor: c(0.775, 0.629, 0.417)),
        Swatch(id: "mozu_real_02", name: "Real 02", category: .real, textureName: "mozu_real_02", avgColor: c(0.526, 0.399, 0.273)),
        Swatch(id: "mozu_real_03", name: "Real 03", category: .real, textureName: "mozu_real_03", avgColor: c(0.572, 0.435, 0.333)),
        Swatch(id: "mozu_real_04", name: "Real 04", category: .real, textureName: "mozu_real_04", avgColor: c(0.301, 0.242, 0.170)),
    ]
}
