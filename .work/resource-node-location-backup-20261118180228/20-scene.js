'use strict';
exports.load = function () {};
exports.unload = function () {};
exports.methods = {
    async findNode(options) {
        const { director } = require('cc');
        const current = await Editor.Message.request('scene', 'query-current-scene');
        const root = director.getScene();
        if (!root) return { message: '当前没有打开的场景或 Prefab。' };
        const currentUuid = typeof current === 'string' ? current : current && (current.uuid || current.assetUuid);
        if (!currentUuid || currentUuid.toLowerCase() !== options.sourceUuid.toLowerCase()) {
            return { message: '请先在编辑器打开这条记录所属的场景或 Prefab，再点击定位节点。' };
        }
        const matches = [];
        const desired = String(options.nodePath).replace(/^\//, '');
        const visit = (node, trail) => {
            const full = [...trail, node.name].join('/');
            if (options.nodeId ? node.uuid === options.nodeId : full === desired || (trail.length === 0 && node.name === desired)) matches.push(node);
            for (const child of node.children || []) visit(child, [...trail, node.name]);
        };
        visit(root, []);
        // Prefab isolation mode wraps the prefab root in an editor Scene.
        if (!matches.length) for (const child of root.children || []) visit(child, []);
        const unique = [...new Map(matches.map(node => [node.uuid, node])).values()];
        if (unique.length !== 1) return { message: unique.length ? '存在同名节点路径，请按报告路径在层级面板中确认。' : '当前打开的内容已变化，未找到对应节点。请保存后重新扫描。' };
        return { uuid: unique[0].uuid };
    },
};
