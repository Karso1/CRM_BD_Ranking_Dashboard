"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AgentProfile } from "@/lib/agent-profiles";

export function AgentProfileButton({name,owner,category,profile,lang}:{name:string;owner:string;category:string;profile?:AgentProfile;lang:"zh"|"en"}) {
  const zh=lang==="zh";
  return <Dialog><DialogTrigger asChild><button type="button" className="agent-name-button" title={zh?"点击查看代理详情":"Click to view agent details"} aria-label={`${zh?"查看代理详情":"View agent details"}: ${name}`}>{name}</button></DialogTrigger>
    <DialogContent className="agent-profile-dialog">
      <DialogTitle>{name}</DialogTitle><DialogDescription>{zh?"代理资料":"Agent details"}</DialogDescription>
      <dl className="agent-profile-fields">
        <div><dt>{zh?"归属 BD":"Owner BD"}</dt><dd>{owner}</dd></div>
        <div><dt>{zh?"类型":"Type"}</dt><dd>{category==="API"?"API":zh?"代理商":"Agent"}</dd></div>
        <div><dt>{zh?"邮箱":"Email"}</dt><dd data-testid="agent-email">{profile?.email || ""}</dd></div>
        <div><dt>{zh?"合作开始时间":"Cooperation start"}</dt><dd data-testid="agent-start">{profile?.cooperationStart || ""}</dd></div>
      </dl>
    </DialogContent>
  </Dialog>;
}
