import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item"
import { DiscordIcon, GithubIcon, LinkSquare02Icon, SparklesIcon, StarsIcon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { t } from "@/lib/i18n"
import { motion } from "motion/react"
import { useState } from "react"
import { toast } from "sonner"

export const VERSION = "2.1.1"

export const AboutPage = () => {
    const [checking, setChecking] = useState(false);
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [hovered, setHovered] = useState(false);

    const visitReleasePage = () => {
        openUrl('https://github.com/mulaRahul/keyviz/releases');
    }

    const checkForUpdates = async () => {
        setChecking(true);
        try {
            const response = await fetch('https://api.github.com/repos/mulaRahul/keyviz/releases/latest')
            const data = await response.json()
            const latestVersion = data.tag_name.substring(1, 6);
            if (latestVersion !== VERSION) {
                setUpdateAvailable(true);
                toast.success(
                    t("about.newVersion", { version: latestVersion }),
                    {
                        action: { label: t("about.view"), onClick: visitReleasePage }
                    }
                );
            } else {
                toast.info(t("about.latest"));
            }
        } catch (error) {
            toast.error(t("about.checkFailed"));
        }
        setChecking(false);
    }

    return <div>
        <div className="py-6 flex flex-col items-center bg-linear-to-b from-secondary to-background">
            <div className="relative w-24 h-24">
                <motion.img
                    animate={{
                        scale: hovered ? 0.8 : 1,
                        opacity: hovered ? 0 : 1,
                    }}
                    className="absolute top-0 left-0 w-full h-full"
                    src="./logo.svg"
                    alt="logo"
                />
                <motion.img
                    initial={{ scale: 1.2, opacity: 0 }}
                    animate={{
                        scale: hovered ? 1 : 1.2,
                        opacity: hovered ? 1 : 0,
                        filter: hovered ? "" : ["hue-rotate(0deg)", "hue-rotate(360deg)"],
                        transition: {
                            delay: 0.1,
                            filter: {
                                repeat: Infinity,
                                duration: 4,
                                ease: "linear",
                            }
                        }
                    }}
                    className="absolute top-0 left-0 w-full h-full"
                    src="./logo-pro.svg"
                    alt="logo-pro"
                />
            </div>
            <h1 className="mt-4 mb-2 text-xl font-semibold">{
                hovered ? "Keyviz Pro" : "Keyviz"
            }</h1>
            <p className="text-center text-sm text-muted-foreground">
                v{VERSION}-beta <br />
                © 2026 Rahul Mula
            </p>
        </div>

        <div className="mt-6 px-6 flex flex-col gap-4">
            <motion.div
                animate={{
                    scale: hovered ? 1.02 : 1,
                    borderColor: hovered ? ["#FFCA94", "#B3FF88", "#00FFF5", "#B367FF", "#FFCA94"] : "transparent",
                }}
                transition={{
                    borderColor: {
                        repeat: Infinity,
                        duration: 4,
                        ease: "linear",
                    }
                }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                className="peer border rounded-lg"
            >
                <Item
                    variant="muted"
                    className="hover:bg-muted"
                >
                    <ItemContent>
                        <ItemTitle>
                            <HugeiconsIcon icon={SparklesIcon} size="1em" /> {t("about.upgrade")}
                        </ItemTitle>
                        <ItemDescription>
                            {t("about.upgrade.desc")}
                        </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                        <Button
                            variant={hovered ? "default" : "outline"}
                            onClick={() => openUrl('https://keyviz.org/pro')}
                        >
                            {t("about.goPro")}
                        </Button>
                    </ItemActions>
                </Item>
            </motion.div>

            <Item variant="muted" className="transition-all peer-hover:blur-xs">
                <ItemContent>
                    <ItemTitle>
                        <HugeiconsIcon icon={StarsIcon} size="1em" /> {t("about.checkUpdates")}
                    </ItemTitle>
                </ItemContent>
                <ItemActions>
                    {
                        updateAvailable
                            ? <Button className="cursor-pointer" onClick={visitReleasePage}>{t("about.updateAvailable")}</Button>
                            : <Button variant="outline" onClick={checkForUpdates} disabled={checking}>{t("about.check")}</Button>
                    }
                </ItemActions>
            </Item>

            <Item variant="muted" className="transition-all peer-hover:blur-xs">
                <ItemContent>
                    <ItemTitle>
                        <HugeiconsIcon icon={GithubIcon} size="1em" /> {t("about.openSource")}
                    </ItemTitle>
                    <ItemDescription className="max-w-100">
                        {t("about.openSource.desc")}
                    </ItemDescription>
                </ItemContent>
                <ItemActions>
                    <Button variant="outline" size="icon" onClick={() => openUrl('https://github.com/mulaRahul/keyviz')}>
                        <HugeiconsIcon icon={LinkSquare02Icon} />
                    </Button>
                </ItemActions>
            </Item>

            <Item variant="muted" className="transition-all peer-hover:blur-xs">
                <ItemContent>
                    <ItemTitle>
                        <HugeiconsIcon icon={DiscordIcon} size="1em" /> {t("about.discord")}
                    </ItemTitle>
                    <ItemDescription className="max-w-100">
                        {t("about.discord.desc")}
                    </ItemDescription>
                </ItemContent>
                <ItemActions>
                    <Button variant="outline" size="icon" onClick={() => openUrl('https://discord.gg/er9pddccyS')}>
                        <HugeiconsIcon icon={LinkSquare02Icon} />
                    </Button>
                </ItemActions>
            </Item>
        </div>
    </div>
}