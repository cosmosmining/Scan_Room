// Pricing engine for the room design — turns the placed-furniture list into an
// itemised quote. Pure value types and pure functions: no I/O, no global state,
// no RealityKit; given the same inputs it always yields the same output, so it is
// trivially testable and safe to call from any actor.
//
// MODEL: every amount is a whole currency unit (USD dollars, no cents) carried as
// an `Int`, so totals are exact — no floating-point drift in a price. Unit prices
// come from a per-category table keyed on `FurnitureItem.category`; the catalogue
// categories use a middot separator ("Kitchen · Base", "Wardrobe · Main", …), and
// the lookup also accepts the plain-spaced spellings so callers and tests can use
// either form. Identical `itemID`s collapse into one `PriceLine` (qty × unit), and
// install is a flat-floored percentage of the subtotal.

import Foundation

// MARK: - Quote value types

/// One line of the quote: a furniture type, how many were placed, and the unit
/// price. `total` is derived (qty × unit) so it can never disagree with its parts.
struct PriceLine: Identifiable, Hashable {
    let id: UUID
    let name: String
    let qty: Int
    let unit: Int
    var total: Int { qty * unit }

    init(id: UUID = UUID(), name: String, qty: Int, unit: Int) {
        self.id = id
        self.name = name
        self.qty = qty
        self.unit = unit
    }
}

/// The full itemised quote: the per-type lines, the goods subtotal, the install
/// fee, the grand total, and the currency code the amounts are denominated in.
struct PriceBreakdown: Hashable {
    let lines: [PriceLine]
    let subtotal: Int
    let install: Int
    let total: Int
    let currency: String
}

// MARK: - Engine

enum Pricing {

    // MARK: Price table

    /// Per-unit price (whole currency units) by furniture category. Unknown
    /// categories fall back to `defaultUnit`.
    static func unitPrice(for item: FurnitureItem) -> Int {
        priceTable[normalize(item.category)] ?? defaultUnit
    }

    /// Default unit price for any category not in the table.
    static let defaultUnit = 300

    /// Category → unit price. Keys are normalised (see `normalize`) so the lookup
    /// is insensitive to the middot vs. plain-space spelling of the catalogue
    /// categories.
    private static let priceTable: [String: Int] = [
        normalize("Kitchen · Base"): 320,
        normalize("Kitchen · Wall"): 185,
        normalize("Kitchen · Tall"): 640,
        normalize("Wardrobe · Main"): 380,
        normalize("Wardrobe · Side"): 240,
        normalize("Seating"): 700,
        normalize("Tables"): 450,
        normalize("Bedroom"): 900,
        normalize("Storage"): 520,
        normalize("Decor"): 120,
    ]

    /// Canonicalise a category string for table lookup: collapse the middot
    /// separator to a plain space, fold case, and trim/squeeze whitespace so
    /// "Kitchen · Base", "Kitchen Base" and "kitchen  base" all match.
    private static func normalize(_ category: String) -> String {
        let spaced = category.replacingOccurrences(of: "·", with: " ")
        let parts = spaced.split(whereSeparator: { $0 == " " || $0 == "\t" })
        return parts.joined(separator: " ").lowercased()
    }

    // MARK: Breakdown

    /// Build the itemised quote. Placed items are grouped by `itemID` into one
    /// line each (qty = count, unit = that type's category price), names resolved
    /// via `catalog`. `subtotal` is the sum of the line totals; `install` is the
    /// greater of $150 and 12% of the subtotal (rounded down); `total` is their
    /// sum.
    ///
    /// Deterministic ordering: lines follow the order each `itemID` first appears
    /// in `items`, so the same placement list always yields the same quote.
    static func breakdown(items: [PlacedFurniture],
                          catalog: [FurnitureItem],
                          currency: String = "USD") -> PriceBreakdown {
        let lookup = Dictionary(catalog.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        var order: [String] = []
        var counts: [String: Int] = [:]
        for placed in items {
            if counts[placed.itemID] == nil { order.append(placed.itemID) }
            counts[placed.itemID, default: 0] += 1
        }

        let lines: [PriceLine] = order.map { itemID in
            let catalogItem = lookup[itemID]
            let name = catalogItem?.name ?? itemID
            let unit = catalogItem.map(unitPrice(for:)) ?? defaultUnit
            return PriceLine(name: name, qty: counts[itemID] ?? 0, unit: unit)
        }

        let subtotal = lines.reduce(0) { $0 + $1.total }
        let install = max(150, subtotal * 12 / 100)
        return PriceBreakdown(lines: lines,
                              subtotal: subtotal,
                              install: install,
                              total: subtotal + install,
                              currency: currency)
    }

    // MARK: Formatting

    /// Format a whole-unit amount as a currency string, e.g. `format(2615) == "$2,615"`.
    /// Uses a thousands-grouped, no-fraction style; falls back to a "$" prefix when
    /// the currency code has no known symbol.
    static func format(_ amount: Int, currency: String = "USD") -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        let grouped = formatter.string(from: NSNumber(value: abs(amount)))
            ?? String(abs(amount))

        let symbol = currencySymbol(currency)
        let sign = amount < 0 ? "-" : ""
        return "\(sign)\(symbol)\(grouped)"
    }

    /// Currency symbol for a code; defaults to "$" so USD reads as expected even
    /// when the locale's symbol differs.
    private static func currencySymbol(_ currency: String) -> String {
        switch currency.uppercased() {
        case "USD", "CAD", "AUD", "NZD", "HKD", "SGD", "MXN": return "$"
        case "EUR": return "€"
        case "GBP": return "£"
        case "JPY", "CNY": return "¥"
        case "INR": return "₹"
        default: return "$"
        }
    }
}
