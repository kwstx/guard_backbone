/**
 * ResourceAnalyzer estimates direct resource usage and economics so action gating
 * can incorporate both cost burden and the opportunity cost of blocking.
 */
export class ResourceAnalyzer {
    analyze(action, requiredResources) {
        const computationalCostScore = this.computeComputationalCost(requiredResources);
        const estimatedFinancialExpenditureUSD = this.computeFinancialExpenditure(requiredResources);
        const bandwidthUtilizationMbps = this.computeBandwidthUtilization(action, requiredResources);
        const opportunityTradeoffScore = this.computeOpportunityTradeoff(action, requiredResources);
        const projectedOpportunityCostOfBlockingUSD = this.computeOpportunityCostOfBlockingUSD(action, estimatedFinancialExpenditureUSD, opportunityTradeoffScore);
        // Higher means better expected return from executing rather than blocking.
        const normalizedOpportunity = this.clamp01(projectedOpportunityCostOfBlockingUSD / 300);
        const normalizedSpend = this.clamp01(estimatedFinancialExpenditureUSD / 200);
        const economicEfficiencyScore = this.clamp01((normalizedOpportunity * 0.7) + ((1 - normalizedSpend) * 0.3));
        return {
            computationalCostScore: Number(computationalCostScore.toFixed(4)),
            estimatedFinancialExpenditureUSD: Number(estimatedFinancialExpenditureUSD.toFixed(2)),
            bandwidthUtilizationMbps: Number(bandwidthUtilizationMbps.toFixed(2)),
            opportunityTradeoffScore: Number(opportunityTradeoffScore.toFixed(4)),
            projectedOpportunityCostOfBlockingUSD: Number(projectedOpportunityCostOfBlockingUSD.toFixed(2)),
            economicEfficiencyScore: Number(economicEfficiencyScore.toFixed(4))
        };
    }
    computeComputationalCost(requiredResources) {
        let cpuMillis = 0;
        let ioWeight = 0;
        for (const resource of requiredResources) {
            if (resource.type === 'CPU') {
                cpuMillis += resource.amount;
            }
            else if (resource.type === 'API_CALL') {
                ioWeight += resource.amount * 15;
            }
            else if (resource.type === 'NETWORK_EGRESS_MB') {
                ioWeight += resource.amount * 8;
            }
        }
        return this.clamp01((Math.min(cpuMillis / 1500, 1) * 0.7) + (Math.min(ioWeight / 120, 1) * 0.3));
    }
    computeFinancialExpenditure(requiredResources) {
        const unitCostMap = {
            CPU: 0.002,
            API_CALL: 0.01,
            NETWORK_EGRESS_MB: 0.0015,
            STORAGE_GB: 0.02,
            HUMAN_REVIEW_MINUTES: 0.4,
        };
        let estimatedCost = 0;
        for (const resource of requiredResources) {
            const unitCost = unitCostMap[resource.type] ?? 0.005;
            estimatedCost += resource.amount * unitCost;
        }
        return estimatedCost;
    }
    computeBandwidthUtilization(action, requiredResources) {
        const directNetworkResource = requiredResources.find((resource) => resource.type === 'NETWORK_EGRESS_MB');
        if (directNetworkResource) {
            // Assume proposed action executes over ~10 seconds by default.
            return directNetworkResource.amount / 10;
        }
        const payloadText = JSON.stringify(action.params ?? {});
        const payloadSizeBytes = Buffer.byteLength(payloadText, 'utf8');
        const inferredMegabytes = payloadSizeBytes / (1024 * 1024);
        // Scale by API calls if present to estimate repeated transfers.
        const apiCalls = requiredResources
            .filter((resource) => resource.type === 'API_CALL')
            .reduce((sum, resource) => sum + resource.amount, 0);
        const transferMB = inferredMegabytes * Math.max(1, apiCalls);
        return transferMB / 10;
    }
    computeOpportunityTradeoff(action, requiredResources) {
        const intentText = `${action.action} ${action.params?.intent ?? ''}`.toUpperCase();
        const urgencySignal = /(INCIDENT|OUTAGE|SECURITY|CRITICAL|HOTFIX|RECOVERY)/.test(intentText) ? 1 : 0;
        const enablementSignal = /(MIGRATE|DEPLOY|RELEASE|AUTOMATE|OPTIMIZE|SCALE)/.test(intentText) ? 1 : 0;
        const maintenanceSignal = /(CLEANUP|ARCHIVE|FORMAT|REFACTOR)/.test(intentText) ? 1 : 0;
        const costlyResources = requiredResources.reduce((sum, resource) => {
            const criticalityWeight = resource.criticality === 'HIGH' ? 1 : resource.criticality === 'MEDIUM' ? 0.6 : 0.3;
            return sum + (criticalityWeight * resource.amount);
        }, 0);
        const complexityPenalty = this.clamp01(costlyResources / 2500);
        return this.clamp01((urgencySignal * 0.5) +
            (enablementSignal * 0.35) +
            (maintenanceSignal * 0.15) -
            (complexityPenalty * 0.25));
    }
    computeOpportunityCostOfBlockingUSD(action, estimatedFinancialExpenditureUSD, opportunityTradeoffScore) {
        // Baseline expected value from action class; block cost is usually higher for urgent/revenue-enabling actions.
        const actionLabel = action.action.toUpperCase();
        const classMultiplier = actionLabel.includes('DELETE') ? 0.7 :
            actionLabel.includes('DEPLOY') ? 1.6 :
                actionLabel.includes('RECOVER') || actionLabel.includes('HOTFIX') ? 1.8 : 1.0;
        const executionValueProxy = Math.max(estimatedFinancialExpenditureUSD * 2.2, 5);
        const tradeoffValue = opportunityTradeoffScore * 120;
        return (executionValueProxy + tradeoffValue) * classMultiplier;
    }
    clamp01(value) {
        return Math.min(Math.max(value, 0), 1);
    }
}
