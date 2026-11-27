#include "CCommanderInventory.h"
// Safe unavailable defaults, overridden by the strongly defined Rust ABI.
__attribute__((weak)) uint32_t commander_inventory_abi_version(void) { return 0; }
__attribute__((weak)) InventorySession *commander_inventory_create(const uint8_t *p, size_t n) { return NULL; }
__attribute__((weak)) int32_t commander_inventory_execute(InventorySession *s, const uint8_t *p, size_t n, void *c, CommanderInventoryOutput o) { return 1; }
__attribute__((weak)) size_t commander_inventory_error_code(InventorySession *s, uint8_t *p, size_t n) { return 0; }
__attribute__((weak)) void commander_inventory_cancel(InventorySession *s) { }
__attribute__((weak)) void commander_inventory_destroy(InventorySession *s) { }
bool tt_inventory_available(void) { return commander_inventory_abi_version() == 1; }

InventorySession *tt_inventory_create(const uint8_t *path, size_t length) {
    return tt_inventory_available() ? commander_inventory_create(path, length) : NULL;
}
int32_t tt_inventory_execute(InventorySession *s, const uint8_t *request, size_t length, void *context, CommanderInventoryOutput output) {
    return tt_inventory_available() ? commander_inventory_execute(s, request, length, context, output) : 1;
}
size_t tt_inventory_error_code(InventorySession *s, uint8_t *output, size_t capacity) {
    return tt_inventory_available() ? commander_inventory_error_code(s, output, capacity) : 0;
}
void tt_inventory_cancel(InventorySession *s) { if (tt_inventory_available()) commander_inventory_cancel(s); }
void tt_inventory_destroy(InventorySession *s) { if (tt_inventory_available()) commander_inventory_destroy(s); }
