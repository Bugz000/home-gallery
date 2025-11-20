// src/folders/Folders.tsx
import * as React from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFolder,
  faFolderOpen,
  faChevronRight,
  faChevronDown,
  faSearch,
  faCamera,
  faTags,
} from "@fortawesome/free-solid-svg-icons";
import { NavBar } from "../navbar/NavBar";
import { getLowerPreviewUrl } from "../utils/preview";

const SHOW_UNKNOWN_MAKES = false;

/* ==================== NODE CLASS ==================== */
class FolderNode {
  name: string;
  path: string;
  images: number = 0;
  videos: number = 0;
  thumbnail?: string | null;
  children: FolderNode[] = [];
  shortId?: string;
  virtual: boolean = false;
  filterQuery?: string;
  icon?: any;
  iconSize?: string;

  constructor(name: string, path: string, options: Partial<FolderNode> = {}) {
    this.name = name;
    this.path = path;
    Object.assign(this, options);
  }

  isFolder() {
    return this.children.length > 0;
  }

  isFilterNode() {
    return this.path.startsWith("Filters");
  }

  addChild(child: FolderNode) {
    if (!this.children.includes(child)) this.children.push(child);
  }

  getSortedChildren() {
    return this.children.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
}

/* ==================== TREE CLASS ==================== */
class FolderTree {
  map: Record<string, FolderNode> = {};
  root: FolderNode[] = [];

  ensureNode(name: string, path: string, parentPath?: string, options: Partial<FolderNode> = {}): FolderNode {
    if (!this.map[path]) {
      const node = new FolderNode(name, path, options);
      this.map[path] = node;
      if (parentPath) {
        const parent = this.map[parentPath] ?? this.ensureNode(parentPath.split("/").pop() || parentPath, parentPath, undefined, { virtual: true, icon: options.icon, iconSize: options.iconSize });
        parent.addChild(node);
      } else {
        this.root.push(node);
      }
    }
    return this.map[path];
  }

  get(path: string) {
    return this.map[path];
  }

  getRoot() {
    return this.root;
  }
}

/* ==================== HELPERS ==================== */
function getBaseDir() {
  const baseEl = document.querySelector("base") as HTMLBaseElement;
  return baseEl?.getAttribute("href")?.replace(/\/$/, "") || "";
}

function getThumbnail(entry: any): string | undefined {
  if (!Array.isArray(entry.previews) || !entry.previews.length) return undefined;
  const url = getLowerPreviewUrl(entry.previews, 128);
  if (!url) return undefined;
  const baseDir = getBaseDir();
  return `${window.location.origin}${baseDir}/${url}`;
}

/* ==================== BUILD FILTERS ==================== */
class FilterBuilder {
  tree: FolderTree;

  constructor(entries: any[]) {
    this.tree = new FolderTree();
    this.build(entries);
  }

  build(entries: any[]) {
    const filtersRoot = this.tree.ensureNode("Filters", "Filters", undefined, { virtual: true, icon: faFolder, iconSize: "text-lg" });
    const camerasRoot = this.tree.ensureNode("Cameras", "Filters/Cameras", filtersRoot.path, { virtual: true, icon: faCamera, iconSize: "text-lg" });
    const tagsRoot = this.tree.ensureNode("Tags", "Filters/Tags", filtersRoot.path, { virtual: true, icon: faTags, iconSize: "text-lg" });
    const untaggedPath = `Filters/Tags/UNTAGGED`;
    this.tree.ensureNode("Untagged", untaggedPath, tagsRoot.path, { virtual: true, icon: faTags, iconSize: "text-sm" });

    const makeDisplayByKey = new Map<string, string>();
    const modelDisplayByKey = new Map<string, string>();

    entries.forEach(entry => {
      const makeRaw = entry.exif?.Make ?? entry.make ?? entry.camera?.make;
      const modelRaw = entry.exif?.Model ?? entry.model ?? entry.camera?.model;
      const makeTrim = (makeRaw || "").toString().trim();
      const modelTrim = (modelRaw || "").toString().trim();
      const makeKey = makeTrim ? makeTrim.toUpperCase() : "UNKNOWN_MAKE";
      const modelKey = modelTrim ? modelTrim.toUpperCase() : "UNKNOWN_MODEL";
      if (!SHOW_UNKNOWN_MAKES && !makeTrim && !modelTrim) return;

      if (!makeDisplayByKey.has(makeKey) && makeTrim) makeDisplayByKey.set(makeKey, makeTrim);
      const makeName = makeDisplayByKey.get(makeKey) || makeTrim || "Unknown";
      const makePath = `Filters/Cameras/${makeKey}`;
      this.tree.ensureNode(makeName, makePath, camerasRoot.path, { virtual: true, icon: faCamera, iconSize: "text-lg" });

      if (modelTrim) {
        const mmKey = `${makeKey}|${modelKey}`;
        if (!modelDisplayByKey.has(mmKey)) modelDisplayByKey.set(mmKey, modelTrim);
        const modelName = modelDisplayByKey.get(mmKey) || modelTrim;
        const modelPath = `${makePath}/${modelKey}`;
        const node = this.tree.ensureNode(modelName, modelPath, makePath, { virtual: true, icon: faCamera, iconSize: "text-sm" });
        node.filterQuery = `model:"${encodeURIComponent(modelTrim)}"`;
        node.images++; this.tree.get(makePath)!.images++; camerasRoot.images++;
      } else {
        this.tree.get(makePath)!.images++; camerasRoot.images++;
      }
    });

    entries.forEach(entry => {
      const tags = Array.isArray(entry.tags) ? entry.tags.map((t:any) => (t||"").toString().trim()).filter(Boolean) : [];
      if (!tags.length) { this.tree.get(untaggedPath)!.images++; tagsRoot.images++; return; }
      tags.forEach(tag => {
        const tagKey = tag.toUpperCase();
        const tagPath = `Filters/Tags/${tagKey}`;
        const node = this.tree.ensureNode(tag, tagPath, tagsRoot.path, { virtual: true, icon: faTags, iconSize: "text-sm" });
        node.filterQuery = `tag:"${encodeURIComponent(tag)}"`; node.images++; tagsRoot.images++;
      });
    });
  }
}

/* ==================== FOLDER INDEX BUILDER ==================== */
class FolderBuilder {
  tree: FolderTree;

  constructor(entries: any[]) {
    this.tree = new FolderTree();
    this.build(entries);
  }

  build(entries: any[]) {
    entries.forEach(entry => {
      const thumbnail = getThumbnail(entry);
      entry.files.forEach((file: any) => {
        const parts = (file.filename || "").split("/").filter(Boolean);
        let accPath = "";
        parts.forEach((part, idx) => {
          accPath = accPath ? `${accPath}/${part}` : part;
          const node = this.tree.ensureNode(part, accPath, idx>0 ? parts.slice(0, idx).join("/") : undefined, { thumbnail: idx===parts.length-1?thumbnail:null });
          if (file.type === "image") node.images++; if (file.type==="video") node.videos++;
          if (idx===parts.length-1 && thumbnail) {
            const match = thumbnail.match(/files\/([a-z0-9]{2})\/([a-z0-9]{2})\/([a-f0-9]{8})/i);
            if (match) node.shortId = `${match[1]}${match[2]}${match[3]}`;
          }
        });
      });
    });
  }
}

/* ==================== FOLDER NODE ITEM ==================== */
interface FolderNodeItemProps { node: FolderNode, level:number, openFolders:Set<string>, toggleFolder:(path:string)=>void }

const FolderNodeItem = React.memo(function FolderNodeItem({ node, level, openFolders, toggleFolder }: FolderNodeItemProps) {
  const navigate = useNavigate();
  const isOpen = openFolders.has(node.path);
  const paddingLeft = 8 + level*16;
  const viewUrl = !node.isFolder() && node.shortId ? `/view/${node.shortId}` : undefined;

  const go = (href:string, hard=false) => {
    const url = href.replace(/^\.\//,"");
    if(hard) window.location.href = url + `?t=${Date.now()}`; else navigate(url);
  };

  const renderIcon = () => {
    if(node.isFolder()){
      if(node.isFilterNode()) return <FontAwesomeIcon icon={node.icon||faFolder} className={`${node.iconSize||"text-lg"} text-purple-300 mr-1`} />;
      return <FontAwesomeIcon icon={isOpen?faFolderOpen:faFolder} className={`${node.iconSize||"text-sm"} text-yellow-400 mr-1`} />;
    }
    if(node.thumbnail) return <img src={node.thumbnail} className="w-6 h-6 object-cover rounded-sm mr-1" alt={node.name} />;
    if(node.icon) return <FontAwesomeIcon icon={node.icon} className={`${node.iconSize||"text-sm"} ${node.isFilterNode()?"text-purple-300":"text-yellow-400"} mr-1`} />;
    return <div className="w-6 h-6 bg-gray-700 rounded-sm mr-1" />;
  };

  return (
    <li>
      <div className="flex items-center gap-2 py-1 px-2 select-none cursor-pointer" style={{paddingLeft}} onClick={e=>{e.stopPropagation(); if(node.isFolder()){toggleFolder(node.path)} else if(viewUrl) navigate(viewUrl)}}>
        {node.isFolder() && <div className="flex items-center justify-center w-5 h-5 cursor-pointer" onClick={e=>{e.stopPropagation(); toggleFolder(node.path)}}>
          <FontAwesomeIcon icon={isOpen?faChevronDown:faChevronRight} className="text-gray-300"/>
        </div>}
        {renderIcon()}
        <div className="flex-1 flex items-center gap-2">
          <span className="truncate font-medium text-sm text-white">{node.name}</span>

		{/* bubbles */}
		{node.isFolder() && node.images>0 && !node.isFilterNode() && 
		  <span className="px-0.5 py-0.25 rounded bg-green-800 text-green-200 text-xs">{node.images}</span>}
		{node.isFolder() && node.videos>0 && !node.isFilterNode() && 
		  <span className="px-0.5 py-0.25 rounded bg-blue-800 text-blue-200 text-xs">{node.videos}</span>}
		{node.isFilterNode() && node.images>0 && 
		  <span className="px-0.5 py-0.25 rounded bg-green-800 text-green-200 text-xs">{node.images}</span>}
		{node.isFilterNode() && node.videos>0 && 
		  <span className="px-0.5 py-0.25 rounded bg-blue-800 text-blue-200 text-xs">{node.videos}</span>}

          {(node.isFolder() || node.filterQuery) && <button type="button" onClick={e=>{e.stopPropagation(); go(node.filterQuery?`./search/${node.filterQuery}`:`./search/index:Pictures%20path~\"${encodeURIComponent(node.path)}\"`, true)}} className="inline-flex items-center justify-center w-6 h-6 rounded-sm hover:bg-white/5 cursor-pointer" title={node.filterQuery?`Filter by ${node.name}`:`Search in ${node.path}`}>
            <FontAwesomeIcon icon={faSearch} className="text-gray-300 text-xs"/>
          </button>}
        </div>
      </div>
      {node.isFolder() && isOpen && node.children.length>0 && <ul>
        {node.getSortedChildren().map(c=><FolderNodeItem key={c.path} node={c} level={level+1} openFolders={openFolders} toggleFolder={toggleFolder}/>)}
      </ul>}
    </li>
  )
});

/* ==================== MAIN COMPONENT ==================== */
export function Folders() {
  const [readyEntries, setReadyEntries] = useState<any[]>([]);
  const [combinedRoot, setCombinedRoot] = useState<FolderNode[]>([]);
  const [combinedMap, setCombinedMap] = useState<FolderTree>(new FolderTree());
  const [openFolders, setOpenFolders] = useState<Set<string>>(()=>{
    const saved = sessionStorage.getItem("openFolders"); return saved? new Set(JSON.parse(saved)) : new Set();
  });

  useEffect(()=>{
    fetch("./api/database.json").then(r=>r.json()).then(json=>{
      const entries = json.entries||json.data||[];
      let i=0; let batch:any[] = [];
      function flushBatch(){ if(!batch.length) return; setReadyEntries(prev=>{
        const next = [...prev,...batch];
        const folderTree = new FolderBuilder(next).tree;
        const filterTree = new FilterBuilder(next).tree;
        const combined = new FolderTree();
        combined.map = {...folderTree.map, ...filterTree.map};
        combined.root = [...filterTree.getRoot(), ...folderTree.getRoot().filter(r=>!filterTree.get(r.path))];
        setCombinedMap(combined); setCombinedRoot(combined.root); batch=[];
        return next;
      })}
      function pushNext(){ while(i<entries.length){ batch.push(entries[i]); i++; if(performance.now()%100<1) break } flushBatch(); if(i<entries.length) requestAnimationFrame(pushNext);}
      pushNext();
    }).catch(()=>{});
  },[]);

  function toggleFolder(path:string){
    setOpenFolders(prev=>{ const next = new Set(prev); next.has(path)?next.delete(path):next.add(path); sessionStorage.setItem("openFolders", JSON.stringify(Array.from(next))); return next;})
  }

  return <>
    <NavBar disableEdit/>
    <ul className="m-4 flex flex-col gap-0">
      {combinedRoot.length===0 && <li className="p-2 text-gray-500">No folders found</li>}
      {combinedRoot
		  .slice()
		  .sort((a, b) => {
			if (a.path.startsWith("Filters")) return -1;
			if (b.path.startsWith("Filters")) return 1;
			const aIsFolder = a.isFolder();
			const bIsFolder = b.isFolder();
			if (aIsFolder && !bIsFolder) return -1;
			if (!aIsFolder && bIsFolder) return 1;
			return a.name.localeCompare(b.name, undefined, { numeric: true });
		  })
		  .map(node => (
			<FolderNodeItem
			  key={node.path}
			  node={node}
			  level={0}
			  openFolders={openFolders}
			  toggleFolder={toggleFolder}
			/>
		  ))}

    </ul>
  </>
}
