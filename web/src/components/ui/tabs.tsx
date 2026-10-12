import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "@/lib/utils";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className,
      )}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full border border-line bg-paper p-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
       className={cn(
         "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full px-4 py-1.5 font-mono text-sm font-medium whitespace-nowrap text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-cobalt disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-ink data-[state=active]:text-paper [&_svg]:size-4 [&_svg]:shrink-0",
         className,
       )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
 }: React.ComponentProps<typeof TabsPrimitive.Content>) {
   return (
     <TabsPrimitive.Content
       data-slot="tabs-content"
       className={cn("flex-1", className)}
       {...props}
     />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
