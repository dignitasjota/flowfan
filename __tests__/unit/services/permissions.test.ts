import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
  hasAnyPermission,
  type Permission,
} from "@/lib/permissions";

describe("permissions", () => {
  describe("getEffectivePermissions", () => {
    it("owner always gets all permissions", () => {
      const perms = getEffectivePermissions("owner");
      expect(perms).toEqual([...ALL_PERMISSIONS]);
    });

    it("owner gets all permissions even with custom role", () => {
      const perms = getEffectivePermissions("owner", ["contacts.read"]);
      expect(perms).toEqual([...ALL_PERMISSIONS]);
    });

    it("manager gets default manager permissions without custom role", () => {
      const perms = getEffectivePermissions("manager");
      expect(perms).toEqual(DEFAULT_ROLE_PERMISSIONS.manager);
    });

    it("chatter gets default chatter permissions without custom role", () => {
      const perms = getEffectivePermissions("chatter");
      expect(perms).toEqual(DEFAULT_ROLE_PERMISSIONS.chatter);
    });

    it("custom role overrides default permissions for manager", () => {
      const custom = ["contacts.read", "analytics.view"];
      const perms = getEffectivePermissions("manager", custom);
      expect(perms).toEqual(custom);
    });

    it("custom role overrides default permissions for chatter", () => {
      const custom = [
        "contacts.read",
        "contacts.create",
        "conversations.read_all",
        "conversations.send_messages",
        "analytics.view",
      ];
      const perms = getEffectivePermissions("chatter", custom);
      expect(perms).toEqual(custom);
    });

    it("filters out invalid permissions from custom role", () => {
      const custom = ["contacts.read", "invalid.permission", "analytics.view"];
      const perms = getEffectivePermissions("chatter", custom);
      expect(perms).toEqual(["contacts.read", "analytics.view"]);
    });

    it("empty custom role array falls back to base role defaults", () => {
      const perms = getEffectivePermissions("manager", []);
      expect(perms).toEqual(DEFAULT_ROLE_PERMISSIONS.manager);
    });

    it("null custom role falls back to base role defaults", () => {
      const perms = getEffectivePermissions("manager", null);
      expect(perms).toEqual(DEFAULT_ROLE_PERMISSIONS.manager);
    });
  });

  describe("hasPermission", () => {
    it("returns true when permission exists", () => {
      expect(hasPermission(["contacts.read", "analytics.view"], "contacts.read")).toBe(true);
    });

    it("returns false when permission does not exist", () => {
      expect(hasPermission(["contacts.read"], "contacts.create")).toBe(false);
    });
  });

  describe("hasAnyPermission", () => {
    it("returns true when at least one permission matches", () => {
      expect(
        hasAnyPermission(["contacts.read"], ["contacts.read", "contacts.create"])
      ).toBe(true);
    });

    it("returns false when no permissions match", () => {
      expect(
        hasAnyPermission(["contacts.read"], ["analytics.view", "settings.manage"])
      ).toBe(false);
    });
  });

  describe("default role permissions", () => {
    it("manager cannot delete contacts", () => {
      expect(DEFAULT_ROLE_PERMISSIONS.manager).not.toContain("contacts.delete");
    });

    it("manager cannot manage settings", () => {
      expect(DEFAULT_ROLE_PERMISSIONS.manager).not.toContain("settings.manage");
    });

    it("chatter cannot create contacts", () => {
      expect(DEFAULT_ROLE_PERMISSIONS.chatter).not.toContain("contacts.create");
    });

    it("chatter cannot read all conversations", () => {
      expect(DEFAULT_ROLE_PERMISSIONS.chatter).not.toContain("conversations.read_all");
    });

    it("chatter can read assigned and send messages", () => {
      expect(DEFAULT_ROLE_PERMISSIONS.chatter).toContain("conversations.read_assigned");
      expect(DEFAULT_ROLE_PERMISSIONS.chatter).toContain("conversations.send_messages");
    });

    it("all permissions in ALL_PERMISSIONS are unique", () => {
      const unique = new Set(ALL_PERMISSIONS);
      expect(unique.size).toBe(ALL_PERMISSIONS.length);
    });
  });
});
