#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
// Weak C defaults report unavailable in standalone packages. The iOS build
// force-links the Rust archive, whose strong symbols replace these defaults.
typedef struct InventorySession InventorySession;
typedef bool (*CommanderInventoryOutput)(void *, const uint8_t *, size_t);
extern uint32_t commander_inventory_abi_version(void);
extern InventorySession *commander_inventory_create(const uint8_t *, size_t);
extern int32_t commander_inventory_execute(InventorySession *, const uint8_t *, size_t, void *, CommanderInventoryOutput);
extern size_t commander_inventory_error_code(InventorySession *, uint8_t *, size_t);
extern void commander_inventory_cancel(InventorySession *);
extern void commander_inventory_destroy(InventorySession *);
bool tt_inventory_available(void);

InventorySession *tt_inventory_create(const uint8_t *, size_t);
int32_t tt_inventory_execute(InventorySession *, const uint8_t *, size_t, void *, CommanderInventoryOutput);
size_t tt_inventory_error_code(InventorySession *, uint8_t *, size_t);
void tt_inventory_cancel(InventorySession *);
void tt_inventory_destroy(InventorySession *);
