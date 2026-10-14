import { PERMISSIONS, type Permission } from '@shared/contract/index.ts';
import { describe, expect, it } from 'vitest';
import { visibleNavItems } from './nav-items';

const labels = (...permissions: Permission[]) =>
  visibleNavItems({ permissions }).map((i) => i.label);

describe('F03-R2: nav filtered by permission', () => {
  it('the super admin sees every item', () => {
    expect(labels(...PERMISSIONS)).toEqual([
      'Live tracking',
      'Admin',
      'Fleets',
      'Users',
      'Invites',
      'Roles',
    ]);
  });

  it('no admin permission: no Admin group', () => {
    expect(labels('live.view', 'table.view', 'table.export', 'share.create')).toEqual([
      'Live tracking',
    ]);
  });

  it.each<[Permission, string]>([
    ['fleets.manage', 'Fleets'],
    ['users.manage', 'Users'],
    ['users.invite', 'Invites'],
    ['roles.manage', 'Roles'],
  ])('%s alone: Admin + %s only', (permission, label) => {
    expect(labels(permission)).toEqual(['Admin', label]);
  });

  it('live tracking only with live.view', () => {
    expect(labels('fleets.manage', 'users.manage')).toEqual(['Admin', 'Fleets', 'Users']);
  });

  it('nothing for no permissions or signed out', () => {
    expect(labels()).toEqual([]);
    expect(visibleNavItems(null)).toEqual([]);
  });
});
