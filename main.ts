import { ItemView, Notice, Plugin, WorkspaceLeaf, TFile } from "obsidian";

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

		// Watch for file changes to update cache
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.updateFileCache(file.path);
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

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.updateFileCache(file.path);
				}
			})
		);
	}

	async buildCache() {
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			await this.updateFileCache(file.path, true);
		}
	}

	async updateFileCache(filePath: string, skipRefresh = false) {
		try {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) return;

			const content = await this.app.vault.read(file);
			const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
			const links = new Set<string>();

			for (const match of matches) {
				const linkName = match.slice(2, -2).split("|")[0].trim();
				if (linkName) links.add(linkName);
			}

			this.linkCache.set(filePath, links);
			if (!skipRefresh) this.refreshView();
		} catch (error) {
			console.error("Failed to update file cache:", error);
		}
	}

	refreshView() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			if (leaf.view instanceof OrphanLinksView) leaf.view.refresh();
		});
	}

	getLinkCache() {
		return this.linkCache;
	}

	async activateView() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		const leaf =
			leaves.length > 0
				? leaves[0]
				: this.app.workspace.getRightLeaf(false);

		if (leaf && leaves.length === 0) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		if (leaf) this.app.workspace.revealLeaf(leaf);
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
			console.error("Failed to refresh orphan links:", error);
		}
	}

	async getOrphans(): Promise<string[]> {
		const paths = new Set(
			this.app.vault.getMarkdownFiles().map((f) => f.path)
		);
		const orphans = new Set<string>();

		for (const [, links] of this.plugin.getLinkCache()) {
			for (const link of links) {
				if (![link + ".md", link].some((path) => paths.has(path))) {
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
			const file = await this.app.vault.create(fileName, "");
			await this.app.workspace.getLeaf().openFile(file);
			new Notice(`Created: ${fileName}`);
		} catch (error) {
			new Notice(`Failed to create file: ${error.message}`);
		}
	}
}
