import { ItemView, Notice, Plugin, WorkspaceLeaf } from "obsidian";

const VIEW_TYPE = "orphan-links-view";

export default class AdoptOrphanPlugin extends Plugin {
	async onload() {
		this.registerView(VIEW_TYPE, (leaf) => new OrphanLinksView(leaf));

		// Add ribbon icon and command
		this.addRibbonIcon("broken-link", "Show orphan links", () =>
			this.activateOrphanView()
		);
		this.addCommand({
			id: "show-orphan-links",
			name: "Show orphan links",
			callback: () => this.activateOrphanView(),
		});

		// Listen for metadata cache updates to refresh view
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.refreshOrphanView();
			})
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", () => {
				this.refreshOrphanView();
			})
		);
	}

	refreshOrphanView() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((leaf) => {
			if (leaf.view instanceof OrphanLinksView) leaf.view.refresh();
		});
	}

	async activateOrphanView() {
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
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return "Orphan links";
	}

	getIcon() {
		return "broken-link";
	}

	async onOpen() {
		await this.refresh();
	}

	async refresh() {
		const container = this.containerEl.children[1];
		container.empty();

		try {
			const orphans = this.getOrphans();

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

			const list = container.createEl("ul", { cls: "orphan-list" });
			orphans.forEach((link) => {
				const item = list.createEl("li");
				const anchor = item.createEl("a", {
					text: link,
					attr: { href: "#" },
				});

				anchor.onclick = (e) => {
					e.preventDefault();
					this.createFile(link);
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

	getOrphans() {
		// Use metadataCache.unresolvedLinks to get all orphan links
		const unresolved = this.app.metadataCache.unresolvedLinks;
		const orphans = new Set<string>();
		for (const links of Object.values(unresolved)) {
			for (const link of Object.keys(links)) {
				orphans.add(link);
			}
		}
		return Array.from(orphans).sort();
	}

	async createFile(linkName: string): Promise<void> {
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
