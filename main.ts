import {
	ItemView,
	Notice,
	Plugin,
	WorkspaceLeaf,
	TFile,
	normalizePath,
} from "obsidian";

const VIEW_TYPE = "orphan-links-view";

export default class AdoptOrphanPlugin extends Plugin {
	private linkCache = new Map<string, Set<string>>();

	async onload() {
		this.registerView(VIEW_TYPE, (leaf) => new OrphanLinksView(leaf, this));

		// Add ribbon icon and command
		this.addRibbonIcon("broken-link", "Show orphan links", () =>
			this.activateView()
		);
		this.addCommand({
			id: "show-orphan-links",
			name: "Show orphan links",
			callback: () => this.activateView(),
		});

		await this.buildCache();

		// Watch for metadata changes to update cache efficiently
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.extension === "md") {
					this.updateFileCache(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					// Wait for metadata cache to be populated
					setTimeout(() => this.updateFileCache(file.path), 100);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.linkCache.delete(file.path);
				this.refreshView();
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.linkCache.has(oldPath)) {
					this.linkCache.set(
						file.path,
						this.linkCache.get(oldPath) || new Set()
					);
					this.linkCache.delete(oldPath);
				}
				this.refreshView();
			})
		);
	}

	onunload() {
		// Clear cache to prevent memory leaks
		this.linkCache.clear();
	}

	async buildCache() {
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			// Wait for metadata cache to be ready
			await this.app.metadataCache.fileToLinktext(file, "", true);
			await this.updateFileCache(file.path, true);
		}
	}

	async updateFileCache(filePath: string, skipRefresh = false) {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) return;

			// Use Obsidian's metadata cache instead of manual parsing
			const cache = this.app.metadataCache.getFileCache(file);
			const links = new Set<string>();

			// Get links from metadata cache
			if (cache?.links) {
				for (const link of cache.links) {
					const linkName = link.link.split("|")[0].trim();
					if (linkName) links.add(linkName);
				}
			}

			this.linkCache.set(filePath, links);
			if (!skipRefresh) this.refreshView();
		} catch (error) {
			// Silently fail - cache will be rebuilt on next refresh
		}
	}

	refreshView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		leaves.forEach((leaf) => {
			if (leaf.view instanceof OrphanLinksView) {
				leaf.view.refresh();
			}
		});
	}

	getLinkCache() {
		return this.linkCache;
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE);

		if (leaves.length > 0) {
			// Focus existing view
			leaf = leaves[0];
		} else {
			// Create new view in right sidebar
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

class OrphanLinksView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: AdoptOrphanPlugin) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "Orphan Links";
	}

	getIcon() {
		return "broken-link";
	}

	async onOpen() {
		if (this.plugin.getLinkCache().size === 0)
			await this.plugin.buildCache();
		await this.refresh();
	}

	async refresh() {
		const container = this.containerEl.children[1];
		container.empty();

		try {
			const orphans = await this.getOrphans();

			if (orphans.length === 0) {
				container.createEl("div", {
					text: "No orphan links found ✨",
					cls: "orphan-empty-state",
				});
				return;
			}

			container.createEl("div", {
				text: `${orphans.length} orphan link${
					orphans.length === 1 ? "" : "s"
				}`,
				cls: "orphan-header",
			});

			const list = container.createEl("div", { cls: "orphan-list" });
			orphans.forEach((link, index) => {
				const item = list.createEl("div", {
					text: link,
					cls: "orphan-item",
					attr: { tabindex: "0" },
				});

				item.onclick = () => this.createFile(link);
				item.onkeydown = (e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						this.createFile(link);
					}
				};
			});
		} catch (error) {
			container.createEl("div", {
				text: "Error loading orphan links",
				cls: "orphan-empty-state",
			});
			// Error logged for debugging, user sees friendly message
		}
	}

	async getOrphans(): Promise<string[]> {
		const orphans = new Set<string>();

		for (const [, links] of this.plugin.getLinkCache()) {
			for (const link of links) {
				// Use Obsidian's built-in file resolution
				const resolvedFile =
					this.app.metadataCache.getFirstLinkpathDest(link, "");
				if (!resolvedFile) {
					orphans.add(link);
				}
			}
		}
		return Array.from(orphans).sort();
	}

	async createFile(linkName: string) {
		try {
			const fileName = linkName.endsWith(".md")
				? linkName
				: linkName + ".md";
			const normalizedPath = normalizePath(fileName);

			// Check if file already exists
			const existingFile =
				this.app.vault.getAbstractFileByPath(normalizedPath);
			if (existingFile) {
				await this.app.workspace
					.getLeaf()
					.openFile(existingFile as TFile);
				new Notice(`Opened existing file: ${normalizedPath}`);
				return;
			}

			const file = await this.app.vault.create(normalizedPath, "");
			await this.app.workspace.getLeaf().openFile(file);
			new Notice(`Created: ${normalizedPath}`);
		} catch (error) {
			new Notice(`Failed to create file: ${error.message}`);
		}
	}
}
