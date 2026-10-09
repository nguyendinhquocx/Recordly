import { useEffect, useState } from "react";

import { AlignmentSelector } from "@/components/ui/alignment-selector";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { NumberInput } from "@/components/ui/number-input";
import { NumberScrubber } from "@/components/ui/number-input-scrub";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { useKeyEvent } from "@/stores/key_event";
import { useKeyStyle } from "@/stores/key_style";
import { ComputerIcon, KeyframesDoubleIcon, KeyframesDoubleRemoveIcon, Link02Icon, ParagraphSpacingIcon, TextAlignLeftIcon, Time03Icon, Unlink02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { availableMonitors, Monitor } from "@tauri-apps/api/window";
import { t } from "@/lib/i18n";


export const AppearanceSettings = () => {
    const appearance = useKeyStyle(state => state.appearance);
    const setAppearance = useKeyStyle(state => state.setAppearance);

    const lingerDurationMs = useKeyEvent(state => state.lingerDurationMs);
    const setLingerDurationMs = useKeyEvent(state => state.setLingerDurationMs);

    const [marginLinked, setMarginLinked] = useState(appearance.marginX === appearance.marginY);
    const [monitors, setMonitors] = useState<Monitor[]>([]);

    useEffect(() => {
        availableMonitors().then(monitors => {
            if (!appearance.monitor && monitors.length > 1) {
                setAppearance({ monitor: monitors[0].name });
            }
            setMonitors(monitors);
        });
    }, []);

    return <div className="flex flex-col gap-y-4 p-6">
        <h1 className="text-xl font-semibold">{t("appearance.title")}</h1>

        <h2 className="text-sm text-muted-foreground font-medium">{t("appearance.position")}</h2>
        {
            monitors.length > 1 &&
            <Item variant="muted">
                <ItemContent>
                    <ItemTitle>
                        <HugeiconsIcon icon={ComputerIcon} size="1em" />
                        {t("appearance.display")}
                    </ItemTitle>
                    <ItemDescription>
                        {t("appearance.display.desc")}
                    </ItemDescription>
                </ItemContent>
                <ItemActions>
                    <Select
                        value={appearance.monitor ?? ""}
                        onValueChange={(value) => {
                            setAppearance({ monitor: value });
                        }}
                    >
                        <SelectTrigger className="w-32">
                            <SelectValue placeholder={t("appearance.display.placeholder")} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {
                                    monitors.map((monitor, index) => (
                                        <SelectItem key={monitor.name} value={monitor.name ?? index.toString()}>
                                            {monitor.name ?? t("appearance.display.fallback", { index: index + 1 })} ({monitor.size.width}x{monitor.size.height})
                                        </SelectItem>
                                    ))
                                }
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </ItemActions>
            </Item>
        }

        <Item variant="muted">
            <ItemContent className="self-start">
                <ItemTitle>
                    <HugeiconsIcon icon={TextAlignLeftIcon} size="1em" /> {t("appearance.alignment")}
                </ItemTitle>
                <ItemDescription>
                    {t("appearance.alignment.desc")}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <AlignmentSelector
                    className="w-32 h-28 text-base"
                    value={appearance.alignment}
                    onChange={(value) => setAppearance({ alignment: value })}
                    disabledOptions={["center"]}
                />
            </ItemActions>
        </Item>

        <Item variant="muted">
            <ItemContent>
                <ItemTitle>
                    <HugeiconsIcon icon={ParagraphSpacingIcon} size="1em" /> {t("appearance.margin")}
                </ItemTitle>
                <ItemDescription>
                    {t("appearance.margin.desc")}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <NumberScrubber
                    value={appearance.marginX}
                    onChange={marginLinked ? (marginX => { setAppearance({ marginX }); setAppearance({ marginY: marginX }); }) : (marginX => setAppearance({ marginX }))}
                    min={0}
                    max={200}
                    step={1}
                    icon={<span className="ml-0.5 text-xs font-medium">X</span>}
                    className="w-18"
                />
                <Toggle
                    variant="default"
                    pressed={marginLinked}
                    onPressedChange={(pressed) => {
                        setMarginLinked(pressed);
                        if (pressed) {
                            setAppearance({ marginY: appearance.marginX });
                        }
                    }}
                    aria-label={t("appearance.margin.linked.aria")}
                >
                    <HugeiconsIcon icon={marginLinked ? Link02Icon : Unlink02Icon} size="1em" />
                </Toggle>
                <NumberScrubber
                    value={appearance.marginY}
                    onChange={(marginY) => setAppearance({ marginY })}
                    min={0}
                    max={200}
                    step={1}
                    icon={<span className="ml-0.5 text-xs font-medium">Y</span>}
                    className="w-18"
                    disabled={marginLinked}
                />
            </ItemActions>
        </Item>

        <h2 className="text-sm text-muted-foreground font-medium">Animation</h2>
        <Item variant="muted">
            <ItemContent>
                <ItemTitle>
                    <HugeiconsIcon icon={Time03Icon} size="1em" /> {t("appearance.duration")}
                </ItemTitle>
                <ItemDescription className="max-w-84">
                    {t("appearance.duration.desc")}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <NumberInput
                    value={lingerDurationMs / 1000}
                    onChange={(value) => setLingerDurationMs(value * 1000)}
                    step={0.2}
                    minValue={0}
                    className="w-32 h-8"
                />
            </ItemActions>
        </Item>

        <Item variant="muted">
            <ItemContent>
                <ItemTitle>
                    <HugeiconsIcon icon={KeyframesDoubleIcon} size="1em" /> {t("appearance.animation")}
                </ItemTitle>
            </ItemContent>
            <ItemActions>
                <Select value={appearance.animation} onValueChange={(value) => setAppearance({ animation: value as any })}>
                    <SelectTrigger className="w-32">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="none">{t("appearance.animation.none")}</SelectItem>
                            <SelectItem value="fade">{t("appearance.animation.fade")}</SelectItem>
                            <SelectItem value="zoom">{t("appearance.animation.zoom")}</SelectItem>
                            <SelectItem value="float">{t("appearance.animation.float")}</SelectItem>
                            <SelectItem value="slide">{t("appearance.animation.slide")}</SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </ItemActions>
        </Item>

        <Item variant="muted">
            <ItemContent>
                <ItemTitle>
                    <HugeiconsIcon icon={KeyframesDoubleRemoveIcon} size="1em" /> {t("appearance.animationSpeed")}
                </ItemTitle>
                <ItemDescription>
                    {t("appearance.animationSpeed.desc")}
                </ItemDescription>
            </ItemContent>
            <ItemActions>
                <NumberInput
                    value={appearance.animationDuration}
                    onChange={(animationDuration) => setAppearance({ animationDuration })}
                    step={0.05}
                    minValue={0.05}
                    maxValue={1}
                    className="w-32 h-8"
                />
            </ItemActions>
        </Item>
    </div>;
}