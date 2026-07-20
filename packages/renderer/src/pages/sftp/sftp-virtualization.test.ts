import assert from 'node:assert/strict';
import test from 'node:test';

import type { Range } from '@tanstack/react-virtual';

import type { TreeDirectoryNode } from './sftp-types';
import {
  extractSftpVirtualRange,
  flattenVisibleSftpTreeRows,
  isSftpVirtualRowContextVisible,
  resolveIntersectingSftpVirtualRowRange,
  resolveSftpVirtualRowScrollOffset,
} from './sftp-virtualization';

/**
 * Creates a minimal directory-tree node for virtualization helper tests.
 *
 * @param path Remote directory path.
 * @param options Tree relationship and expansion overrides.
 * @returns Tree node with stable defaults.
 */
const createTreeNode = (
  path: string,
  options: Partial<Pick<TreeDirectoryNode, 'children' | 'isExpanded' | 'parentPath'>> = {},
): TreeDirectoryNode => ({
  path,
  name: path.split('/').filter(Boolean).at(-1) ?? '/',
  parentPath: options.parentPath,
  isHidden: false,
  children: options.children ?? [],
  isExpanded: options.isExpanded ?? false,
  isLoaded: true,
  isLoading: false,
});

test('SFTP tree flattening retains visual depth and omits collapsed descendants', () => {
  const treeNodes: Record<string, TreeDirectoryNode> = {
    '/': createTreeNode('/', { children: ['/srv', '/tmp'], isExpanded: true }),
    '/srv': createTreeNode('/srv', {
      children: ['/srv/app'],
      isExpanded: true,
      parentPath: '/',
    }),
    '/srv/app': createTreeNode('/srv/app', { parentPath: '/srv' }),
    '/tmp': createTreeNode('/tmp', {
      children: ['/tmp/cache'],
      isExpanded: false,
      parentPath: '/',
    }),
    '/tmp/cache': createTreeNode('/tmp/cache', { parentPath: '/tmp' }),
  };

  assert.deepEqual(flattenVisibleSftpTreeRows(treeNodes, ['/']), [
    { path: '/', depth: 0, positionInSet: 1, setSize: 1 },
    { path: '/srv', depth: 1, positionInSet: 1, setSize: 2 },
    { path: '/srv/app', depth: 2, positionInSet: 1, setSize: 1 },
    { path: '/tmp', depth: 1, positionInSet: 2, setSize: 2 },
  ]);
});

test('SFTP virtual range keeps valid focus and inline-edit rows mounted', () => {
  const range: Range = {
    startIndex: 10,
    endIndex: 12,
    overscan: 1,
    count: 20,
  };

  assert.deepEqual(extractSftpVirtualRange(range, [2, 11, 18, -1, 20]), [2, 9, 10, 11, 12, 13, 18]);
});

test('SFTP marquee row intersection includes boundary contact and excludes prefix rows', () => {
  assert.deepEqual(resolveIntersectingSftpVirtualRowRange(100, 34, 98, 132, 200), {
    startIndex: 0,
    endIndex: 3,
  });
  assert.equal(resolveIntersectingSftpVirtualRowRange(100, 34, 98, 0, 97), null);
  assert.equal(resolveIntersectingSftpVirtualRowRange(0, 34, 98, 100, 200), null);
});

test('SFTP tree viewport checks the complete parent-current-child context', () => {
  assert.equal(isSftpVirtualRowContextVisible([4, 5, 6], 30, 90, 120), true);
  assert.equal(isSftpVirtualRowContextVisible([3, 4, 5], 30, 100, 120), false);
  assert.equal(isSftpVirtualRowContextVisible([], 30, 0, 120), false);
});

test('SFTP tree target offset aligns near one third and clamps at both ends', () => {
  assert.equal(resolveSftpVirtualRowScrollOffset(0, 30, 100, 300, 1 / 3), 0);
  assert.equal(resolveSftpVirtualRowScrollOffset(20, 30, 100, 300, 1 / 3), 515);
  assert.equal(resolveSftpVirtualRowScrollOffset(99, 30, 100, 300, 1 / 3), 2700);
});
